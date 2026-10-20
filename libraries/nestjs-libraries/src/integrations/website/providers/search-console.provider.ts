import { google } from 'googleapis';
import * as process from 'node:process';
import { makeSecureId } from '@gitroom/nestjs-libraries/services/make.secure.id';
import {
  WebsiteAuthDetails,
  WebsiteProvider,
  WebsiteTable,
} from '@gitroom/nestjs-libraries/integrations/website/website.interface';
import {
  WebsiteAbstract,
  WebsiteMetric,
} from '@gitroom/nestjs-libraries/integrations/website/website.abstract';

const clientAndSearchConsole = () => {
  const client = new google.auth.OAuth2({
    clientId: process.env.GOOGLE_SEO_CLIENT_ID,
    clientSecret: process.env.GOOGLE_SEO_CLIENT_SECRET,
    redirectUri: `${process.env.FRONTEND_URL}/websites/oauth/search-console`,
  });

  return { client };
};

export class SearchConsoleProvider
  extends WebsiteAbstract
  implements WebsiteProvider
{
  identifier = 'search-console';
  name = 'Google Search Console';
  authType = 'oauth' as const;
  // Search Console data is final after about 3 days
  protected override dataDelay = 3;
  scopes = [
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/webmasters.readonly',
  ];

  async generateAuthUrl() {
    const state = makeSecureId(7);
    const { client } = clientAndSearchConsole();
    return {
      url: client.generateAuthUrl({
        access_type: 'offline',
        prompt: 'consent',
        state,
        scope: this.scopes.slice(0),
      }),
      state,
    };
  }

  async authenticate(params: { code?: string }): Promise<WebsiteAuthDetails> {
    const { client } = clientAndSearchConsole();
    const { tokens } = await client.getToken(params.code!);
    const { email } = await client.getTokenInfo(tokens.access_token!);

    return {
      accessToken: tokens.access_token!,
      refreshToken: tokens.refresh_token!,
      expiresIn: Math.floor((tokens.expiry_date! - Date.now()) / 1000),
      name: email || this.name,
    };
  }

  async refreshToken(refresh_token: string): Promise<WebsiteAuthDetails> {
    const { client } = clientAndSearchConsole();
    client.setCredentials({ refresh_token });
    const { credentials } = await client.refreshAccessToken();

    return {
      accessToken: credentials.access_token!,
      refreshToken: credentials.refresh_token || refresh_token,
      expiresIn: Math.floor((credentials.expiry_date! - Date.now()) / 1000),
      name: this.name,
    };
  }

  async listProperties(accessToken: string) {
    const { siteEntry } = await this.request(
      'https://www.googleapis.com/webmasters/v3/sites',
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    return (siteEntry || [])
      .filter((p: any) => p.permissionLevel !== 'siteUnverifiedUser')
      .map((p: any) => ({ id: p.siteUrl, name: p.siteUrl }));
  }

  private query(
    accessToken: string,
    siteUrl: string,
    days: number,
    dimension: string | string[],
    rowLimit: number
  ) {
    const dimensions = Array.isArray(dimension) ? dimension : [dimension];
    return this.request(
      `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(
        siteUrl
      )}/searchAnalytics/query`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...this.range(days, dimension === 'date'),
          dimensions,
          rowLimit,
        }),
      }
    );
  }

  async metrics(
    accessToken: string,
    siteUrl: string,
    days: number
  ): Promise<WebsiteMetric[]> {
    const { rows = [] } = await this.query(
      accessToken,
      siteUrl,
      days,
      'date',
      25000
    );

    const points = (key: string, multiply = 1) =>
      rows.map((r: any) => ({ date: r.keys[0], value: r[key] * multiply }));

    return [
      this.toMetric('Clicks', points('clicks'), days),
      this.toMetric('Impressions', points('impressions'), days),
      this.toMetric('CTR', points('ctr', 100), days, true),
      this.toMetric('Average Position', points('position'), days, true, true),
    ];
  }

  async tables(
    accessToken: string,
    siteUrl: string,
    days: number
  ): Promise<WebsiteTable[]> {
    const [queries, pages] = await Promise.all([
      this.query(accessToken, siteUrl, days, 'query', 20),
      this.query(accessToken, siteUrl, days, 'page', 20),
    ]);

    const toRows = (rows: any[] = []) =>
      rows.map((r) => [
        r.keys[0],
        r.clicks,
        r.impressions,
        Number(r.position.toFixed(1)),
      ]);

    return [
      {
        label: 'Top Queries',
        columns: ['Query', 'Clicks', 'Impressions', 'Position'],
        rows: toRows(queries.rows),
      },
      {
        label: 'Top Pages',
        columns: ['Page', 'Clicks', 'Impressions', 'Position'],
        rows: toRows(pages.rows),
      },
    ];
  }

  async insightData(
    accessToken: string,
    siteUrl: string,
    days: number
  ): Promise<WebsiteTable[]> {
    const { rows = [] } = await this.query(
      accessToken,
      siteUrl,
      days,
      ['query', 'page'],
      250
    );

    return [
      {
        label: 'Search Console queries by page',
        columns: ['Query', 'Page', 'Clicks', 'Impressions', 'CTR %', 'Position'],
        rows: rows.map((r: any) => [
          r.keys[0],
          r.keys[1],
          r.clicks,
          r.impressions,
          Number((r.ctr * 100).toFixed(2)),
          Number(r.position.toFixed(1)),
        ]),
      },
    ];
  }
}
