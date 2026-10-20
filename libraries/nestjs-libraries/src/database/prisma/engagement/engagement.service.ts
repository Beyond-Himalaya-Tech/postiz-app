import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import dayjs from 'dayjs';
import { Integration } from '@prisma/client';
import { TemporalService } from 'nestjs-temporal-core';
import { TypedSearchAttributes } from '@temporalio/common';
import { organizationId } from '@gitroom/nestjs-libraries/temporal/temporal.search.attribute';
import { EngagementRepository } from '@gitroom/nestjs-libraries/database/prisma/engagement/engagement.repository';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { IntegrationManager } from '@gitroom/nestjs-libraries/integrations/integration.manager';
import { RefreshIntegrationService } from '@gitroom/nestjs-libraries/integrations/refresh.integration.service';
import { OpenaiService } from '@gitroom/nestjs-libraries/openai/openai.service';
import { EngagementParams } from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import { EngagementSettingsDto } from '@gitroom/nestjs-libraries/dtos/engagement/engagement.settings.dto';

@Injectable()
export class EngagementService {
  constructor(
    private _engagementRepository: EngagementRepository,
    private _integrationService: IntegrationService,
    private _integrationManager: IntegrationManager,
    private _refreshIntegrationService: RefreshIntegrationService,
    private _openaiService: OpenaiService,
    private _temporalService: TemporalService
  ) {}

  // Channels whose provider can read engagement
  getSupportedProviders() {
    return this._integrationManager
      .getAllowedSocialsIntegrations()
      .filter(
        (identifier) =>
          !!this._integrationManager.getSocialIntegration(identifier)
            ?.fetchEngagement
      );
  }

  getSettings(org: string) {
    return this._engagementRepository.getSettings(org);
  }

  private async getIntegration(org: string, integrationId: string) {
    const integration = await this._integrationService.getIntegrationById(
      org,
      integrationId
    );
    if (!integration || integration.deletedAt) {
      throw new HttpException('Channel not found', HttpStatus.NOT_FOUND);
    }

    const provider = this._integrationManager.getSocialIntegration(
      integration.providerIdentifier
    );
    if (!provider?.fetchEngagement || !provider.replyEngagement) {
      throw new HttpException(
        'This channel does not support engagement',
        HttpStatus.BAD_REQUEST
      );
    }

    return { integration, provider };
  }

  async setSettings(
    org: string,
    integrationId: string,
    body: EngagementSettingsDto
  ) {
    await this.getIntegration(org, integrationId);
    await this._engagementRepository.setSettings(org, integrationId, {
      ...body,
      keywords: body.keywords.map((k) => k.trim()).filter(Boolean),
    });
    await this.processWorkflow(body.active, org, integrationId);
  }

  async processWorkflow(active: boolean, org: string, integrationId: string) {
    const workflowId = `engagement-${integrationId}`;
    if (active) {
      try {
        return await this._temporalService.client
          .getRawClient()
          ?.workflow.start('engagementWorkflow', {
            workflowId,
            taskQueue: 'main',
            args: [{ integrationId }],
            // Keep a running workflow, it reads the settings on every run
            workflowIdConflictPolicy: 'USE_EXISTING',
            typedSearchAttributes: new TypedSearchAttributes([
              { key: organizationId, value: org },
            ]),
          });
      } catch (err) {
        return false;
      }
    }

    try {
      return await this._temporalService.terminateWorkflow(workflowId);
    } catch (err) {
      return false;
    }
  }

  private async getToken(integration: Integration) {
    if (
      integration.tokenExpiration &&
      dayjs(integration.tokenExpiration).isBefore(dayjs())
    ) {
      const refresh = await this._refreshIntegrationService.refresh(
        integration,
        'engagement'
      );
      if (refresh) {
        return refresh.accessToken;
      }
    }

    return integration.token;
  }

  // Called by the engagement workflow, and by "Check now"
  async collect(integrationId: string) {
    const setting = await this._engagementRepository.getSettingByIntegration(
      integrationId
    );
    if (!setting?.active) {
      return false;
    }

    const org = setting.organizationId;
    const { integration, provider } = await this.getIntegration(
      org,
      integrationId
    );
    if (integration.disabled || integration.refreshNeeded) {
      return false;
    }

    const now = new Date();
    const params: EngagementParams = {
      since: setting.lastCheckedAt || dayjs().subtract(3, 'day').toDate(),
      posts: (
        await this._engagementRepository.getPublishedPosts(
          integrationId,
          dayjs().subtract(14, 'day').toDate()
        )
      ).map((p) => ({ id: p.id, releaseId: p.releaseId! })),
      keywords: setting.keywords,
      kinds: [
        ...(setting.comments ? (['comment'] as const) : []),
        ...(setting.keywords.length ? (['keyword'] as const) : []),
        // Direct messages need extra Meta permissions, so they are opt in
        ...(setting.messages && process.env.ENGAGEMENT_MESSAGES === 'true'
          ? (['message'] as const)
          : []),
      ],
    };

    const items = await provider.fetchEngagement!(
      integration,
      await this.getToken(integration),
      params
    );
    await this._engagementRepository.saveItems(org, integrationId, items);
    await this._engagementRepository.setChecked(integrationId, now);
    await this.draftNewItems(integrationId, provider.name, setting.brandContext);
    return true;
  }

  private async draftNewItems(
    integrationId: string,
    platform: string,
    brandContext: string | null
  ) {
    for (const item of await this._engagementRepository.getItemsToDraft(
      integrationId
    )) {
      try {
        const draft = await this._openaiService.draftEngagementReply({
          platform,
          kind: item.kind,
          authorName: item.authorName,
          content: item.content,
          brandContext: brandContext || '',
        });
        if (!draft) {
          continue;
        }

        await this._engagementRepository.updateItem(item.id, {
          status: draft.skip ? 'skipped' : 'drafted',
          draft: draft.reply,
          isLead: draft.isLead,
          leadReason: draft.isLead ? draft.leadReason : undefined,
        });
      } catch (err) {
        Logger.error(
          `Engagement draft failed: ${(err as Error).message}`,
          'EngagementService'
        );
      }
    }
  }

  async checkNow(org: string, integrationId: string) {
    await this.getIntegration(org, integrationId);
    try {
      await this.collect(integrationId);
    } catch (err) {
      throw new HttpException(
        'Could not load engagement from this channel',
        HttpStatus.BAD_REQUEST
      );
    }
  }

  getItems(
    org: string,
    query: { status?: string; kind?: string; integrationId?: string; leads?: string; page?: string }
  ) {
    return this._engagementRepository.getItems(org, {
      status: query.status,
      kind: query.kind,
      integrationId: query.integrationId,
      leads: query.leads === 'true',
      page: Math.max(0, Number(query.page) || 0),
    });
  }

  private async getItem(org: string, id: string) {
    const item = await this._engagementRepository.getItem(org, id);
    if (!item) {
      throw new HttpException('Not found', HttpStatus.NOT_FOUND);
    }

    return item;
  }

  async updateDraft(org: string, id: string, draft: string) {
    await this.getItem(org, id);
    await this._engagementRepository.updateItem(id, {
      draft,
      status: 'drafted',
    });
  }

  async dismiss(org: string, id: string) {
    await this.getItem(org, id);
    await this._engagementRepository.updateItem(id, { status: 'dismissed' });
  }

  async regenerate(org: string, id: string) {
    const item = await this.getItem(org, id);
    const { provider } = await this.getIntegration(org, item.integrationId);
    const setting = await this._engagementRepository.getSettingByIntegration(
      item.integrationId
    );

    try {
      const draft = await this._openaiService.draftEngagementReply({
        platform: provider.name,
        kind: item.kind,
        authorName: item.authorName,
        content: item.content,
        brandContext: setting?.brandContext || '',
      });
      await this._engagementRepository.updateItem(id, {
        draft: draft?.reply || '',
        status: 'drafted',
      });
      return { draft: draft?.reply || '' };
    } catch (err) {
      throw new HttpException(
        'Could not write a reply, try again',
        HttpStatus.BAD_REQUEST
      );
    }
  }

  async getLead(org: string, id: string) {
    const item = await this.getItem(org, id);
    const { provider } = await this.getIntegration(org, item.integrationId);
    return {
      name: item.authorName,
      handle: item.authorHandle,
      profileUrl: item.authorUrl || undefined,
      platform: provider.name,
      content: item.content,
      url: item.url || undefined,
      reason: item.leadReason || undefined,
    };
  }

  async markLeadSynced(org: string, id: string) {
    await this.getItem(org, id);
    await this._engagementRepository.updateItem(id, {
      isLead: true,
      leadSyncedAt: new Date(),
    });
  }

  // Only ever called from an explicit "Send" click, replies are never sent automatically
  async send(org: string, id: string) {
    const item = await this.getItem(org, id);
    if (item.status === 'sent') {
      throw new HttpException('Already sent', HttpStatus.BAD_REQUEST);
    }
    if (!item.draft?.trim()) {
      throw new HttpException('The reply is empty', HttpStatus.BAD_REQUEST);
    }

    const { integration, provider } = await this.getIntegration(
      org,
      item.integrationId
    );

    try {
      const { id: replyId } = await provider.replyEngagement!(
        integration,
        await this.getToken(integration),
        {
          kind: item.kind as any,
          externalId: item.externalId,
          threadExternalId: item.threadExternalId,
        },
        item.draft
      );

      await this._engagementRepository.updateItem(id, {
        status: 'sent',
        sentAt: new Date(),
        replyExternalId: replyId,
      });
    } catch (err) {
      Logger.error(
        `Engagement reply failed: ${(err as Error).message}`,
        'EngagementService'
      );
      throw new HttpException(
        `Could not send the reply to ${provider.name}`,
        HttpStatus.BAD_REQUEST
      );
    }
  }
}
