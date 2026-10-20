import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { Injectable } from '@nestjs/common';
import { EngagementInput } from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import { EngagementSettingsDto } from '@gitroom/nestjs-libraries/dtos/engagement/engagement.settings.dto';

const settingSelect = {
  id: true,
  integrationId: true,
  comments: true,
  messages: true,
  keywords: true,
  brandContext: true,
  active: true,
  lastCheckedAt: true,
};

// Inbox tabs map to more than one stored status
const statusGroups: Record<string, string[]> = {
  open: ['new', 'drafted'],
  closed: ['dismissed', 'skipped'],
};

const itemSelect = {
  id: true,
  integrationId: true,
  kind: true,
  postId: true,
  authorName: true,
  authorHandle: true,
  authorUrl: true,
  content: true,
  url: true,
  receivedAt: true,
  status: true,
  draft: true,
  sentAt: true,
  isLead: true,
  leadReason: true,
  leadSyncedAt: true,
};

@Injectable()
export class EngagementRepository {
  constructor(
    private _setting: PrismaRepository<'engagementSetting'>,
    private _item: PrismaRepository<'engagementItem'>,
    private _post: PrismaRepository<'post'>
  ) {}

  getSettings(org: string) {
    return this._setting.model.engagementSetting.findMany({
      where: { organizationId: org },
      select: settingSelect,
    });
  }

  // Used by the background workflow, which only knows the integration
  getSettingByIntegration(integrationId: string) {
    return this._setting.model.engagementSetting.findUnique({
      where: { integrationId },
      select: { ...settingSelect, organizationId: true },
    });
  }

  setSettings(org: string, integrationId: string, body: EngagementSettingsDto) {
    return this._setting.model.engagementSetting.upsert({
      where: { integrationId },
      create: { organizationId: org, integrationId, ...body },
      update: body,
      select: { id: true },
    });
  }

  setChecked(integrationId: string, lastCheckedAt: Date) {
    return this._setting.model.engagementSetting.update({
      where: { integrationId },
      data: { lastCheckedAt },
      select: { id: true },
    });
  }

  getPublishedPosts(integrationId: string, since: Date) {
    return this._post.model.post.findMany({
      where: {
        integrationId,
        state: 'PUBLISHED',
        parentPostId: null,
        deletedAt: null,
        releaseId: { not: null },
        publishDate: { gte: since },
      },
      select: { id: true, releaseId: true },
      orderBy: { publishDate: 'desc' },
      take: 30,
    });
  }

  saveItems(org: string, integrationId: string, items: EngagementInput[]) {
    return this._item.model.engagementItem.createMany({
      data: items.map((item) => ({
        organizationId: org,
        integrationId,
        kind: item.kind,
        externalId: item.externalId,
        threadExternalId: item.threadExternalId,
        postId: item.postId,
        authorName: item.authorName || '',
        authorHandle: item.authorHandle || '',
        authorUrl: item.authorUrl,
        content: item.content,
        url: item.url,
        receivedAt: item.receivedAt,
      })),
      skipDuplicates: true,
    });
  }

  getItemsToDraft(integrationId: string) {
    return this._item.model.engagementItem.findMany({
      where: { integrationId, status: 'new', draft: null, deletedAt: null },
      select: { id: true, kind: true, authorName: true, content: true },
      orderBy: { receivedAt: 'desc' },
      take: 25,
    });
  }

  getItems(
    org: string,
    filters: {
      status?: string;
      kind?: string;
      integrationId?: string;
      leads?: boolean;
      page: number;
    }
  ) {
    return this._item.model.engagementItem.findMany({
      where: {
        organizationId: org,
        deletedAt: null,
        ...(filters.status
          ? { status: { in: statusGroups[filters.status] || [filters.status] } }
          : {}),
        ...(filters.kind ? { kind: filters.kind } : {}),
        ...(filters.integrationId
          ? { integrationId: filters.integrationId }
          : {}),
        ...(filters.leads ? { isLead: true } : {}),
      },
      select: itemSelect,
      orderBy: { receivedAt: 'desc' },
      skip: filters.page * 50,
      take: 50,
    });
  }

  // Includes the fields the provider needs to reply
  getItem(org: string, id: string) {
    return this._item.model.engagementItem.findFirst({
      where: { id, organizationId: org, deletedAt: null },
      select: {
        ...itemSelect,
        externalId: true,
        threadExternalId: true,
        integration: { select: { providerIdentifier: true } },
      },
    });
  }

  updateItem(
    id: string,
    data: {
      status?: string;
      draft?: string;
      sentAt?: Date;
      replyExternalId?: string;
      isLead?: boolean;
      leadReason?: string;
      leadSyncedAt?: Date;
    }
  ) {
    return this._item.model.engagementItem.update({
      where: { id },
      data,
      select: { id: true },
    });
  }
}
