import {
  Body,
  Controller,
  Get,
  HttpException,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Organization } from '@prisma/client';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { EngagementService } from '@gitroom/nestjs-libraries/database/prisma/engagement/engagement.service';
import { EngagementSettingsDto } from '@gitroom/nestjs-libraries/dtos/engagement/engagement.settings.dto';
import { EngagementDraftDto } from '@gitroom/nestjs-libraries/dtos/engagement/engagement.draft.dto';
import { ThirdPartyManager } from '@gitroom/nestjs-libraries/3rdparties/thirdparty.manager';
import { AuthService } from '@gitroom/helpers/auth/auth.service';
import { CheckPolicies } from '@gitroom/backend/services/auth/permissions/permissions.ability';
import {
  AuthorizationActions,
  Sections,
} from '@gitroom/backend/services/auth/permissions/permission.exception.class';

@ApiTags('Engagement')
@Controller('/engagement')
export class EngagementController {
  constructor(
    private _engagementService: EngagementService,
    private _thirdPartyManager: ThirdPartyManager
  ) {}

  @Get('/providers')
  getSupportedProviders() {
    return this._engagementService.getSupportedProviders();
  }

  @Get('/settings')
  getSettings(@GetOrgFromRequest() org: Organization) {
    return this._engagementService.getSettings(org.id);
  }

  @Put('/settings/:integrationId')
  @CheckPolicies([AuthorizationActions.Create, Sections.AI])
  setSettings(
    @GetOrgFromRequest() org: Organization,
    @Param('integrationId') integrationId: string,
    @Body() body: EngagementSettingsDto
  ) {
    return this._engagementService.setSettings(org.id, integrationId, body);
  }

  @Post('/settings/:integrationId/check')
  @CheckPolicies([AuthorizationActions.Create, Sections.AI])
  checkNow(
    @GetOrgFromRequest() org: Organization,
    @Param('integrationId') integrationId: string
  ) {
    return this._engagementService.checkNow(org.id, integrationId);
  }

  @Get('/items')
  getItems(
    @GetOrgFromRequest() org: Organization,
    @Query('status') status: string,
    @Query('kind') kind: string,
    @Query('integrationId') integrationId: string,
    @Query('leads') leads: string,
    @Query('page') page: string
  ) {
    return this._engagementService.getItems(org.id, {
      status,
      kind,
      integrationId,
      leads,
      page,
    });
  }

  @Put('/items/:id/draft')
  updateDraft(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Body() body: EngagementDraftDto
  ) {
    return this._engagementService.updateDraft(org.id, id, body.draft);
  }

  @Post('/items/:id/regenerate')
  @CheckPolicies([AuthorizationActions.Create, Sections.AI])
  regenerate(@GetOrgFromRequest() org: Organization, @Param('id') id: string) {
    return this._engagementService.regenerate(org.id, id);
  }

  @Post('/items/:id/dismiss')
  dismiss(@GetOrgFromRequest() org: Organization, @Param('id') id: string) {
    return this._engagementService.dismiss(org.id, id);
  }

  @Post('/items/:id/send')
  send(@GetOrgFromRequest() org: Organization, @Param('id') id: string) {
    return this._engagementService.send(org.id, id);
  }

  // The CRM lives in the third party system, connected from Settings
  @Post('/items/:id/crm')
  async sendToCrm(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string
  ) {
    const connected = (
      await this._thirdPartyManager.getAllThirdPartiesByOrganization(org.id)
    ).find((p) => p.identifier === 'hubspot-crm');
    if (!connected) {
      throw new HttpException(
        'Connect HubSpot CRM in Settings > Third party first',
        400
      );
    }

    const thirdParty = await this._thirdPartyManager.getIntegrationById(
      org.id,
      connected.id
    );
    const lead = await this._engagementService.getLead(org.id, id);

    try {
      await this._thirdPartyManager
        .getThirdPartyByName('hubspot-crm')!
        .instance.createLead!(
          AuthService.fixedDecryption(thirdParty!.apiKey),
          lead
        );
    } catch (err) {
      throw new HttpException('Could not create the contact in HubSpot', 400);
    }

    await this._engagementService.markLeadSynced(org.id, id);
  }
}
