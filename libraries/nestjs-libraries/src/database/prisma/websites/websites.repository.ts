import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { Injectable } from '@nestjs/common';
import { AuthService } from '@gitroom/helpers/auth/auth.service';
import { CreateWebsiteDto } from '@gitroom/nestjs-libraries/dtos/websites/create.website.dto';

const sourceSelect = {
  id: true,
  websiteId: true,
  providerIdentifier: true,
  name: true,
  externalId: true,
  refreshNeeded: true,
  createdAt: true,
};

@Injectable()
export class WebsitesRepository {
  constructor(
    private _website: PrismaRepository<'website'>,
    private _websiteSource: PrismaRepository<'websiteSource'>,
    private _contentSource: PrismaRepository<'websiteContentSource'>,
    private _contentTask: PrismaRepository<'websiteContentTask'>
  ) {}

  getWebsites(org: string) {
    return this._website.model.website.findMany({
      where: { organizationId: org, deletedAt: null },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        name: true,
        domain: true,
        sources: {
          where: { deletedAt: null },
          select: sourceSelect,
        },
      },
    });
  }

  getWebsite(org: string, id: string) {
    return this._website.model.website.findFirst({
      where: { id, organizationId: org, deletedAt: null },
      select: { id: true, name: true, domain: true },
    });
  }

  createWebsite(org: string, body: CreateWebsiteDto) {
    return this._website.model.website.create({
      data: {
        organizationId: org,
        name: body.name,
        domain: body.domain,
      },
      select: { id: true },
    });
  }

  async deleteWebsite(org: string, id: string) {
    await this._websiteSource.model.websiteSource.updateMany({
      where: { websiteId: id, organizationId: org, deletedAt: null },
      data: { deletedAt: new Date(), externalId: null },
    });

    await this._contentSource.model.websiteContentSource.updateMany({
      where: { websiteId: id, organizationId: org, deletedAt: null },
      data: { deletedAt: new Date() },
    });

    return this._website.model.website.updateMany({
      where: { id, organizationId: org, deletedAt: null },
      data: { deletedAt: new Date() },
    });
  }

  getSourcesByWebsite(org: string, websiteId: string) {
    return this._websiteSource.model.websiteSource.findMany({
      where: { websiteId, organizationId: org, deletedAt: null },
      orderBy: { createdAt: 'asc' },
      select: sourceSelect,
    });
  }

  // Includes the decrypted tokens, only for calling the provider, never return it to a client
  async getSourceWithToken(org: string, id: string) {
    const source = await this._websiteSource.model.websiteSource.findFirst({
      where: { id, organizationId: org, deletedAt: null },
    });

    if (!source) {
      return null;
    }

    return {
      ...source,
      token: AuthService.fixedDecryption(source.token),
      refreshToken: source.refreshToken
        ? AuthService.fixedDecryption(source.refreshToken)
        : null,
    };
  }

  // Reconnecting the same account replaces the tokens of the existing source
  createOrUpdateSource(
    org: string,
    websiteId: string,
    providerIdentifier: string,
    data: {
      name: string;
      token: string;
      refreshToken?: string;
      tokenExpiration?: Date;
    }
  ) {
    const tokens = {
      token: AuthService.fixedEncryption(data.token),
      refreshToken: data.refreshToken
        ? AuthService.fixedEncryption(data.refreshToken)
        : null,
      tokenExpiration: data.tokenExpiration,
    };

    return this._websiteSource.model.websiteSource.upsert({
      where: {
        websiteId_providerIdentifier_name: {
          websiteId,
          providerIdentifier,
          name: data.name,
        },
      },
      create: {
        organizationId: org,
        websiteId,
        providerIdentifier,
        name: data.name,
        ...tokens,
      },
      update: {
        ...tokens,
        refreshNeeded: false,
        deletedAt: null,
      },
      select: { id: true },
    });
  }

  updateSourceToken(
    id: string,
    data: { token: string; refreshToken?: string; tokenExpiration?: Date }
  ) {
    return this._websiteSource.model.websiteSource.update({
      where: { id },
      data: {
        token: AuthService.fixedEncryption(data.token),
        ...(data.refreshToken
          ? { refreshToken: AuthService.fixedEncryption(data.refreshToken) }
          : {}),
        tokenExpiration: data.tokenExpiration,
        refreshNeeded: false,
      },
      select: { id: true },
    });
  }

  setRefreshNeeded(id: string) {
    return this._websiteSource.model.websiteSource.update({
      where: { id },
      data: { refreshNeeded: true },
      select: { id: true },
    });
  }

  setSourceProperty(org: string, id: string, externalId: string) {
    return this._websiteSource.model.websiteSource.updateMany({
      where: { id, organizationId: org, deletedAt: null },
      data: { externalId },
    });
  }

  getContentSource(org: string, websiteId: string) {
    return this._contentSource.model.websiteContentSource.findFirst({
      where: { websiteId, organizationId: org, deletedAt: null },
      select: {
        id: true,
        providerIdentifier: true,
        owner: true,
        repo: true,
        branch: true,
        contentPath: true,
        urlPrefix: true,
      },
    });
  }

  // Includes the decrypted token, only for calling the provider, never return it to a client
  async getContentSourceWithToken(org: string, websiteId: string) {
    const source = await this._contentSource.model.websiteContentSource.findFirst(
      {
        where: { websiteId, organizationId: org, deletedAt: null },
      }
    );

    if (!source) {
      return null;
    }

    return { ...source, token: AuthService.fixedDecryption(source.token) };
  }

  setContentSource(
    org: string,
    websiteId: string,
    data: {
      providerIdentifier: string;
      owner: string;
      repo: string;
      branch: string;
      contentPath: string;
      urlPrefix: string;
      token: string;
    }
  ) {
    const values = {
      ...data,
      token: AuthService.fixedEncryption(data.token),
    };

    return this._contentSource.model.websiteContentSource.upsert({
      where: { websiteId },
      create: { organizationId: org, websiteId, ...values },
      update: { ...values, deletedAt: null },
      select: { id: true },
    });
  }

  deleteContentSource(org: string, websiteId: string) {
    return this._contentSource.model.websiteContentSource.updateMany({
      where: { websiteId, organizationId: org, deletedAt: null },
      data: { deletedAt: new Date() },
    });
  }

  createContentTask(
    org: string,
    websiteId: string,
    data: {
      type: string;
      title: string;
      filePath: string;
      url: string;
      branch: string;
      prUrl: string;
      summary: string;
    }
  ) {
    return this._contentTask.model.websiteContentTask.create({
      data: { organizationId: org, websiteId, ...data },
      select: { id: true },
    });
  }

  getContentTasks(org: string, websiteId: string) {
    return this._contentTask.model.websiteContentTask.findMany({
      where: { websiteId, organizationId: org, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        type: true,
        title: true,
        filePath: true,
        url: true,
        prUrl: true,
        summary: true,
        createdAt: true,
      },
    });
  }

  getContentTask(org: string, id: string) {
    return this._contentTask.model.websiteContentTask.findFirst({
      where: { id, organizationId: org, deletedAt: null },
      select: { id: true, title: true, url: true, summary: true },
    });
  }

  // The property is cleared, so connecting the account again asks for it again
  deleteSource(org: string, id: string) {
    return this._websiteSource.model.websiteSource.updateMany({
      where: { id, organizationId: org, deletedAt: null },
      data: { deletedAt: new Date(), externalId: null },
    });
  }
}
