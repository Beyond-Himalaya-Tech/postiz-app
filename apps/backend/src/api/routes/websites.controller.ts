import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Organization } from '@prisma/client';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { WebsitesService } from '@gitroom/nestjs-libraries/database/prisma/websites/websites.service';
import { CreateWebsiteDto } from '@gitroom/nestjs-libraries/dtos/websites/create.website.dto';
import { ConnectWebsiteSourceDto } from '@gitroom/nestjs-libraries/dtos/websites/connect.website.source.dto';
import { SetWebsitePropertyDto } from '@gitroom/nestjs-libraries/dtos/websites/set.website.property.dto';
import { SetContentSourceDto } from '@gitroom/nestjs-libraries/dtos/websites/set.content.source.dto';
import { CreateWebsiteContentDto } from '@gitroom/nestjs-libraries/dtos/websites/create.website.content.dto';
import { CheckPolicies } from '@gitroom/backend/services/auth/permissions/permissions.ability';
import {
  AuthorizationActions,
  Sections,
} from '@gitroom/backend/services/auth/permissions/permission.exception.class';

@ApiTags('Websites')
@Controller('/websites')
export class WebsitesController {
  constructor(private _websitesService: WebsitesService) {}

  @Get('/')
  getWebsites(@GetOrgFromRequest() org: Organization) {
    return this._websitesService.getWebsites(org.id);
  }

  @Post('/')
  createWebsite(
    @GetOrgFromRequest() org: Organization,
    @Body() body: CreateWebsiteDto
  ) {
    return this._websitesService.createWebsite(org.id, body);
  }

  @Get('/providers')
  getProviders() {
    return this._websitesService.getProviders();
  }

  @Post('/connect/:provider')
  connect(
    @GetOrgFromRequest() org: Organization,
    @Param('provider') provider: string,
    @Body() body: ConnectWebsiteSourceDto
  ) {
    return this._websitesService.connect(org.id, provider, body);
  }

  @Get('/sources/:sourceId/properties')
  getProperties(
    @GetOrgFromRequest() org: Organization,
    @Param('sourceId') sourceId: string
  ) {
    return this._websitesService.getProperties(org.id, sourceId);
  }

  @Put('/sources/:sourceId/property')
  setProperty(
    @GetOrgFromRequest() org: Organization,
    @Param('sourceId') sourceId: string,
    @Body() body: SetWebsitePropertyDto
  ) {
    return this._websitesService.setProperty(org.id, sourceId, body.externalId);
  }

  @Get('/sources/:sourceId/metrics')
  getMetrics(
    @GetOrgFromRequest() org: Organization,
    @Param('sourceId') sourceId: string,
    @Query('date') date: string
  ) {
    return this._websitesService.getMetrics(org.id, sourceId, date);
  }

  @Get('/sources/:sourceId/tables')
  getTables(
    @GetOrgFromRequest() org: Organization,
    @Param('sourceId') sourceId: string,
    @Query('date') date: string
  ) {
    return this._websitesService.getTables(org.id, sourceId, date);
  }

  @Delete('/sources/:sourceId')
  deleteSource(
    @GetOrgFromRequest() org: Organization,
    @Param('sourceId') sourceId: string
  ) {
    return this._websitesService.deleteSource(org.id, sourceId);
  }

  @Post('/content/:taskId/promote')
  @CheckPolicies([AuthorizationActions.Create, Sections.AI])
  promote(
    @GetOrgFromRequest() org: Organization,
    @Param('taskId') taskId: string
  ) {
    return this._websitesService.promote(org.id, taskId);
  }

  @Get('/:id/content-source')
  getContentSource(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string
  ) {
    return this._websitesService.getContentSource(org.id, id);
  }

  @Put('/:id/content-source')
  setContentSource(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Body() body: SetContentSourceDto
  ) {
    return this._websitesService.setContentSource(org.id, id, body);
  }

  @Delete('/:id/content-source')
  deleteContentSource(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string
  ) {
    return this._websitesService.deleteContentSource(org.id, id);
  }

  @Get('/:id/articles')
  listArticles(@GetOrgFromRequest() org: Organization, @Param('id') id: string) {
    return this._websitesService.listArticles(org.id, id);
  }

  @Get('/:id/insights')
  @CheckPolicies([AuthorizationActions.Create, Sections.AI])
  getInsights(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Query('date') date: string,
    @Query('refresh') refresh: string
  ) {
    return this._websitesService.getInsights(
      org.id,
      id,
      date,
      refresh === 'true'
    );
  }

  @Get('/:id/content')
  getContentTasks(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string
  ) {
    return this._websitesService.getContentTasks(org.id, id);
  }

  @Post('/:id/content')
  @CheckPolicies([AuthorizationActions.Create, Sections.AI])
  createContent(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Body() body: CreateWebsiteContentDto
  ) {
    return this._websitesService.createContent(org.id, id, body);
  }

  @Get('/:id')
  getWebsite(@GetOrgFromRequest() org: Organization, @Param('id') id: string) {
    return this._websitesService.getWebsite(org.id, id);
  }

  @Get('/:id/connect/:provider')
  getAuthUrl(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Param('provider') provider: string
  ) {
    return this._websitesService.getAuthUrl(org.id, id, provider);
  }

  @Delete('/:id')
  deleteWebsite(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string
  ) {
    return this._websitesService.deleteWebsite(org.id, id);
  }
}
