import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import dayjs from 'dayjs';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';
import { WebsitesRepository } from '@gitroom/nestjs-libraries/database/prisma/websites/websites.repository';
import { WebsiteManager } from '@gitroom/nestjs-libraries/integrations/website/website.manager';
import {
  WebsiteAuthDetails,
  WebsiteProvider,
  WebsiteTable,
} from '@gitroom/nestjs-libraries/integrations/website/website.interface';
import { WebsiteRefreshToken } from '@gitroom/nestjs-libraries/integrations/website/website.abstract';
import { CreateWebsiteDto } from '@gitroom/nestjs-libraries/dtos/websites/create.website.dto';
import { ConnectWebsiteSourceDto } from '@gitroom/nestjs-libraries/dtos/websites/connect.website.source.dto';
import { SetContentSourceDto } from '@gitroom/nestjs-libraries/dtos/websites/set.content.source.dto';
import { CreateWebsiteContentDto } from '@gitroom/nestjs-libraries/dtos/websites/create.website.content.dto';
import { ContentManager } from '@gitroom/nestjs-libraries/integrations/website/content/content.manager';
import { OpenaiService } from '@gitroom/nestjs-libraries/openai/openai.service';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';

const allowedDays = [7, 30, 90];
// Keeps prompts inside the model context and the cost predictable
const maxSampleLength = 12000;
const maxArticleLength = 60000;

@Injectable()
export class WebsitesService {
  constructor(
    private _websitesRepository: WebsitesRepository,
    private _websiteManager: WebsiteManager,
    private _contentManager: ContentManager,
    private _openaiService: OpenaiService
  ) {}

  getProviders() {
    return this._websiteManager.getAllProviders();
  }

  getWebsites(org: string) {
    return this._websitesRepository.getWebsites(org);
  }

  createWebsite(org: string, body: CreateWebsiteDto) {
    return this._websitesRepository.createWebsite(org, body);
  }

  async deleteWebsite(org: string, id: string) {
    await this._websitesRepository.deleteWebsite(org, id);
  }

  async getWebsite(org: string, id: string) {
    const website = await this._websitesRepository.getWebsite(org, id);
    if (!website) {
      throw new HttpException('Website not found', HttpStatus.NOT_FOUND);
    }

    return {
      ...website,
      sources: await this._websitesRepository.getSourcesByWebsite(org, id),
    };
  }

  private getProvider(identifier: string) {
    const provider = this._websiteManager.getProvider(identifier);
    if (!provider) {
      throw new HttpException('Invalid provider', HttpStatus.BAD_REQUEST);
    }

    return provider;
  }

  async getAuthUrl(org: string, websiteId: string, identifier: string) {
    await this.getWebsite(org, websiteId);
    const provider = this.getProvider(identifier);
    if (!provider.generateAuthUrl) {
      throw new HttpException(
        'Provider does not use OAuth',
        HttpStatus.BAD_REQUEST
      );
    }

    const { url, state } = await provider.generateAuthUrl();
    await ioRedis.set(
      `website-oauth:${state}`,
      JSON.stringify({ org, websiteId, identifier }),
      'EX',
      3600
    );

    return { url };
  }

  async connect(org: string, identifier: string, body: ConnectWebsiteSourceDto) {
    const provider = this.getProvider(identifier);
    let websiteId = body.websiteId;
    let auth: WebsiteAuthDetails;

    try {
      if (provider.authType === 'oauth') {
        const saved = await ioRedis.get(`website-oauth:${body.state}`);
        const state = saved ? JSON.parse(saved) : null;
        // del is atomic, so a double submit of the same callback only connects once
        if (
          !state ||
          state.org !== org ||
          state.identifier !== identifier ||
          !(await ioRedis.del(`website-oauth:${body.state}`))
        ) {
          throw new HttpException(
            'Invalid or expired state',
            HttpStatus.BAD_REQUEST
          );
        }

        websiteId = state.websiteId;
        auth = await provider.authenticate({ code: body.code });
      } else {
        if (!body.apiKey || !websiteId) {
          throw new HttpException('Missing API key', HttpStatus.BAD_REQUEST);
        }

        await this.getWebsite(org, websiteId);
        auth = await provider.authenticate({ apiKey: body.apiKey });
      }
    } catch (err) {
      if (err instanceof HttpException) {
        throw err;
      }

      throw new HttpException(
        `Could not connect ${provider.name}`,
        HttpStatus.BAD_REQUEST
      );
    }

    await this.getWebsite(org, websiteId!);

    const source = await this._websitesRepository.createOrUpdateSource(
      org,
      websiteId!,
      identifier,
      {
        name: auth.name,
        token: auth.accessToken,
        refreshToken: auth.refreshToken,
        tokenExpiration: auth.expiresIn
          ? dayjs().add(auth.expiresIn, 'second').toDate()
          : undefined,
      }
    );

    return { id: source.id, websiteId };
  }

  private async refresh(
    provider: WebsiteProvider,
    source: { id: string; refreshToken: string | null }
  ) {
    if (!provider.refreshToken || !source.refreshToken) {
      return null;
    }

    try {
      const auth = await provider.refreshToken(source.refreshToken);
      await this._websitesRepository.updateSourceToken(source.id, {
        token: auth.accessToken,
        refreshToken: auth.refreshToken,
        tokenExpiration: auth.expiresIn
          ? dayjs().add(auth.expiresIn, 'second').toDate()
          : undefined,
      });
      return auth.accessToken;
    } catch (err) {
      return null;
    }
  }

  // Loads the source, refreshes an expired token, and retries once on 401
  private async withToken<T>(
    org: string,
    sourceId: string,
    call: (provider: WebsiteProvider, token: string, externalId: string) => Promise<T>,
    requireProperty = true
  ): Promise<T> {
    const source = await this._websitesRepository.getSourceWithToken(
      org,
      sourceId
    );
    if (!source) {
      throw new HttpException('Source not found', HttpStatus.NOT_FOUND);
    }

    if (requireProperty && !source.externalId) {
      throw new HttpException('Select a property first', HttpStatus.BAD_REQUEST);
    }

    const provider = this.getProvider(source.providerIdentifier);
    let token = source.token;

    if (
      source.tokenExpiration &&
      dayjs(source.tokenExpiration).isBefore(dayjs())
    ) {
      token = (await this.refresh(provider, source)) || token;
    }

    try {
      return await call(provider, token, source.externalId!);
    } catch (err) {
      if (!(err instanceof WebsiteRefreshToken)) {
        throw this.loadError(provider);
      }
    }

    const newToken = await this.refresh(provider, source);
    if (!newToken) {
      await this._websitesRepository.setRefreshNeeded(source.id);
      throw new HttpException(
        `Please reconnect ${provider.name}`,
        HttpStatus.BAD_REQUEST
      );
    }

    try {
      return await call(provider, newToken, source.externalId!);
    } catch (err) {
      throw this.loadError(provider);
    }
  }

  private loadError(provider: WebsiteProvider) {
    return new HttpException(
      `Could not load data from ${provider.name}`,
      HttpStatus.BAD_REQUEST
    );
  }

  getProperties(org: string, sourceId: string) {
    return this.withToken(
      org,
      sourceId,
      (provider, token) => provider.listProperties(token),
      false
    );
  }

  async setProperty(org: string, sourceId: string, externalId: string) {
    const properties = await this.getProperties(org, sourceId);
    if (!properties.some((p) => p.id === externalId)) {
      throw new HttpException('Invalid property', HttpStatus.BAD_REQUEST);
    }

    await this._websitesRepository.setSourceProperty(org, sourceId, externalId);
  }

  private async cached<T>(key: string, load: () => Promise<T>): Promise<T> {
    const saved = await ioRedis.get(key);
    if (saved) {
      return JSON.parse(saved);
    }

    const data = await load();
    await ioRedis.set(key, JSON.stringify(data), 'EX', 3600);
    return data;
  }

  getMetrics(org: string, sourceId: string, date: string) {
    const days = allowedDays.includes(Number(date)) ? Number(date) : 30;
    return this.withToken(org, sourceId, (provider, token, externalId) =>
      this.cached(
        `website-source:${org}:${sourceId}:${externalId}:${days}:metrics`,
        () => provider.metrics(token, externalId, days)
      )
    );
  }

  getTables(org: string, sourceId: string, date: string) {
    const days = allowedDays.includes(Number(date)) ? Number(date) : 30;
    return this.withToken(org, sourceId, (provider, token, externalId) =>
      this.cached(
        `website-source:${org}:${sourceId}:${externalId}:${days}:tables`,
        () => provider.tables(token, externalId, days)
      )
    );
  }

  async deleteSource(org: string, sourceId: string) {
    await this._websitesRepository.deleteSource(org, sourceId);
  }

  // Wrapped, so a website without a repository still returns a JSON body
  async getContentSource(org: string, websiteId: string) {
    return {
      source: await this._websitesRepository.getContentSource(org, websiteId),
    };
  }

  async setContentSource(
    org: string,
    websiteId: string,
    body: SetContentSourceDto
  ) {
    await this.getWebsite(org, websiteId);
    const provider = this._contentManager.getProvider(body.providerIdentifier);
    if (!provider) {
      throw new HttpException('Invalid provider', HttpStatus.BAD_REQUEST);
    }

    const config = {
      providerIdentifier: body.providerIdentifier,
      owner: body.owner,
      repo: body.repo,
      branch: body.branch,
      contentPath: (body.contentPath || '').replace(/^\/+|\/+$/g, ''),
      urlPrefix: body.urlPrefix || '/',
      token: body.token,
    };

    if (!(await provider.checkConnection(config))) {
      throw new HttpException(
        'Could not access the repository with write permission',
        HttpStatus.BAD_REQUEST
      );
    }

    await this._websitesRepository.setContentSource(org, websiteId, config);
  }

  async deleteContentSource(org: string, websiteId: string) {
    await this._websitesRepository.deleteContentSource(org, websiteId);
  }

  private async getContent(org: string, websiteId: string) {
    const config = await this._websitesRepository.getContentSourceWithToken(
      org,
      websiteId
    );
    if (!config) {
      throw new HttpException(
        'Connect the content repository first',
        HttpStatus.BAD_REQUEST
      );
    }

    const provider = this._contentManager.getProvider(config.providerIdentifier);
    if (!provider) {
      throw new HttpException('Invalid provider', HttpStatus.BAD_REQUEST);
    }

    return { config, provider };
  }

  async listArticles(org: string, websiteId: string) {
    const { config, provider } = await this.getContent(org, websiteId);
    try {
      return await provider.listArticles(config);
    } catch (err) {
      throw new HttpException(
        `Could not read the repository from ${provider.name}`,
        HttpStatus.BAD_REQUEST
      );
    }
  }

  async getInsights(
    org: string,
    websiteId: string,
    date: string,
    refresh: boolean
  ) {
    const days = allowedDays.includes(Number(date)) ? Number(date) : 30;
    const key = `website-insights:${org}:${websiteId}:${days}`;
    if (!refresh) {
      const saved = await ioRedis.get(key);
      if (saved) {
        return JSON.parse(saved);
      }
    }

    const website = await this.getWebsite(org, websiteId);
    const sources = website.sources.filter(
      (s) => s.externalId && !s.refreshNeeded
    );

    // A failing source is skipped, the analysis runs on what is available
    const tables = (
      await Promise.all(
        sources.map((source) =>
          this.withToken<WebsiteTable[]>(org, source.id, (provider, token, externalId) =>
            (provider.insightData || provider.tables).call(
              provider,
              token,
              externalId,
              days
            )
          ).catch((): WebsiteTable[] => [])
        )
      )
    ).flat();

    if (!tables.length) {
      throw new HttpException(
        'Connect Search Console or Google Analytics first',
        HttpStatus.BAD_REQUEST
      );
    }

    const articles = await this.listArticles(org, websiteId).catch(() => []);

    try {
      const opportunities = await this._openaiService.seoInsights({
        domain: website.domain,
        tables,
        articles,
      });

      await ioRedis.set(key, JSON.stringify(opportunities), 'EX', 86400);
      return opportunities;
    } catch (err) {
      throw new HttpException(
        'Could not analyse the website, try again',
        HttpStatus.BAD_REQUEST
      );
    }
  }

  async createContent(
    org: string,
    websiteId: string,
    body: CreateWebsiteContentDto
  ) {
    const website = await this.getWebsite(org, websiteId);
    const { config, provider } = await this.getContent(org, websiteId);
    const articles = await this.listArticles(org, websiteId);

    try {
      let path: string;
      let slug: string;
      let title: string;
      let summary: string;
      let content: string;

      if (body.type === 'update_article') {
        // Only files that exist in the content folder can be changed
        const article = articles.find((a) => a.path === body.filePath);
        if (!article) {
          throw new HttpException('Article not found', HttpStatus.BAD_REQUEST);
        }

        const original = await provider.readArticle(config, article.path);
        if (original.length > maxArticleLength) {
          throw new HttpException(
            'This article is too long to rewrite automatically',
            HttpStatus.BAD_REQUEST
          );
        }

        const rewrite = await this._openaiService.rewriteArticle({
          ...body,
          original,
        });
        if (!rewrite) {
          throw new Error('Empty rewrite');
        }

        ({ path, slug } = article);
        ({ summary, content } = rewrite);
        title = `Update: ${body.title}`;
      } else {
        const sample = articles[0];
        const article = await this._openaiService.writeArticle({
          ...body,
          styleSample: sample
            ? (await provider.readArticle(config, sample.path)).slice(
                0,
                maxSampleLength
              )
            : '',
        });
        if (!article) {
          throw new Error('Empty article');
        }

        slug =
          article.slug
            .toLowerCase()
            .replace(/[^a-z0-9-]+/g, '-')
            .replace(/^-+|-+$/g, '') || makeId(8).toLowerCase();
        const extension = sample?.path.endsWith('.md') ? '.md' : '.mdx';
        const folder = config.contentPath ? `${config.contentPath}/` : '';
        path = `${folder}${slug}${extension}`;
        if (articles.some((a) => a.path === path)) {
          slug = `${slug}-${makeId(4).toLowerCase()}`;
          path = `${folder}${slug}${extension}`;
        }

        ({ title, summary, content } = article);
      }

      // File names can hold characters that are not allowed in a git ref
      const branchSlug =
        slug
          .toLowerCase()
          .replace(/[^a-z0-9-]+/g, '-')
          .replace(/^-+|-+$/g, '')
          .slice(0, 60) || 'article';
      const branch = `postiz/${branchSlug}-${makeId(6).toLowerCase()}`;
      const { prUrl } = await provider.proposeChange(config, {
        branch,
        path,
        content,
        title,
        body: `${summary}\n\n**Why:** ${body.reason}\n\n**Target queries:** ${body.targetQueries.join(
          ', '
        )}\n\n_Generated by Postiz, review before merging._`,
      });

      const prefix = `/${config.urlPrefix.replace(/^\/+|\/+$/g, '')}/`.replace(
        '//',
        '/'
      );
      const url = `https://${website.domain}${prefix}${slug}`;

      const task = await this._websitesRepository.createContentTask(
        org,
        websiteId,
        {
          type: body.type === 'update_article' ? 'update' : 'new',
          title,
          filePath: path,
          url,
          branch,
          prUrl,
          summary,
        }
      );

      return { id: task.id, prUrl, url, title };
    } catch (err) {
      if (err instanceof HttpException) {
        throw err;
      }

      Logger.error(
        `Website content failed: ${(err as Error).message}`,
        'WebsitesService'
      );
      throw new HttpException(
        'Could not create the article, try again',
        HttpStatus.BAD_REQUEST
      );
    }
  }

  getContentTasks(org: string, websiteId: string) {
    return this._websitesRepository.getContentTasks(org, websiteId);
  }

  async promote(org: string, taskId: string) {
    const task = await this._websitesRepository.getContentTask(org, taskId);
    if (!task) {
      throw new HttpException('Not found', HttpStatus.NOT_FOUND);
    }

    try {
      return {
        content: await this._openaiService.promoteArticle({
          title: task.title.replace(/^Update: /, ''),
          summary: task.summary,
          url: task.url,
        }),
      };
    } catch (err) {
      throw new HttpException(
        'Could not write the post, try again',
        HttpStatus.BAD_REQUEST
      );
    }
  }
}
