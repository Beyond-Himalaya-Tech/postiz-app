import { google } from 'googleapis';
import * as process from 'node:process';
import { makeSecureId } from '@gitroom/nestjs-libraries/services/make.secure.id';
import {
  WebsiteAuthDetails,
  WebsiteProperty,
  WebsiteProvider,
  WebsiteTable,
} from '@gitroom/nestjs-libraries/integrations/website/website.interface';
import {
  WebsiteAbstract,
  WebsiteMetric,
} from '@gitroom/nestjs-libraries/integrations/website/website.abstract';

const clientAndGa4 = () => {
  const client = new google.auth.OAuth2({
    clientId: process.env.GOOGLE_SEO_CLIENT_ID,
    clientSecret: process.env.GOOGLE_SEO_CLIENT_SECRET,
    redirectUri: `${process.env.FRONTEND_URL}/websites/oauth/ga4`,
  });

  return { client };
};

export class Ga4Provider extends WebsiteAbstract implements WebsiteProvider {
  identifier = 'ga4';
  name = 'Google Analytics 4';
  authType = 'oauth' as const;
  scopes = [
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/analytics.readonly',
  ];

  async generateAuthUrl() {
    const state = makeSecureId(7);
    const { client } = clientAndGa4();
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
    const { client } = clientAndGa4();
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
    const { client } = clientAndGa4();
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
    const properties: WebsiteProperty[] = [];
    let pageToken = '';

    do {
      const { accountSummaries = [], nextPageToken } = await this.request(
        `https://analyticsadmin.googleapis.com/v1beta/accountSummaries?pageSize=200${
          pageToken ? `&pageToken=${pageToken}` : ''
        }`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );

      for (const account of accountSummaries) {
        for (const property of account.propertySummaries || []) {
          properties.push({
            id: property.property,
            name: `${account.displayName} / ${property.displayName}`,
          });
        }
      }

      pageToken = nextPageToken;
    } while (pageToken);

    return properties;
  }

  private runReport(accessToken: string, property: string, body: any) {
    return this.request(
      `https://analyticsdata.googleapis.com/v1beta/${property}:runReport`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      }
    );
  }

  async metrics(
    accessToken: string,
    property: string,
    days: number
  ): Promise<WebsiteMetric[]> {
    const labels = ['Active Users', 'Sessions', 'Page Views', 'Key Events'];
    const { rows = [] } = await this.runReport(accessToken, property, {
      dateRanges: [this.range(days)],
      dimensions: [{ name: 'date' }],
      metrics: [
        { name: 'activeUsers' },
        { name: 'sessions' },
        { name: 'screenPageViews' },
        { name: 'keyEvents' },
      ],
    });

    // GA4 returns dates as YYYYMMDD
    const date = (value: string) =>
      `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;

    return labels.map((label, index) =>
      this.toMetric(
        label,
        rows.map((r: any) => ({
          date: date(r.dimensionValues[0].value),
          value: Number(r.metricValues[index].value),
        })),
        days
      )
    );
  }

  async tables(
    accessToken: string,
    property: string,
    days: number
  ): Promise<WebsiteTable[]> {
    const report = (dimension: string) =>
      this.runReport(accessToken, property, {
        dateRanges: [this.range(days, false)],
        dimensions: [{ name: dimension }],
        metrics: [{ name: 'sessions' }, { name: 'activeUsers' }],
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
        limit: 20,
      });

    const [pages, sources] = await Promise.all([
      report('pagePath'),
      report('sessionSourceMedium'),
    ]);

    const toRows = (rows: any[] = []) =>
      rows.map((r) => [
        r.dimensionValues[0].value,
        Number(r.metricValues[0].value),
        Number(r.metricValues[1].value),
      ]);

    return [
      {
        label: 'Top Pages',
        columns: ['Page', 'Sessions', 'Users'],
        rows: toRows(pages.rows),
      },
      {
        label: 'Top Sources',
        columns: ['Source / Medium', 'Sessions', 'Users'],
        rows: toRows(sources.rows),
      },
    ];
  }

  async insightData(
    accessToken: string,
    property: string,
    days: number
  ): Promise<WebsiteTable[]> {
    const { rows = [] } = await this.runReport(accessToken, property, {
      dateRanges: [this.range(days, false)],
      dimensions: [{ name: 'pagePath' }],
      metrics: [
        { name: 'sessions' },
        { name: 'activeUsers' },
        { name: 'engagementRate' },
        { name: 'averageSessionDuration' },
      ],
      orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
      limit: 100,
    });

    return [
      {
        label: 'Google Analytics pages',
        columns: [
          'Page',
          'Sessions',
          'Users',
          'Engagement rate %',
          'Avg session seconds',
        ],
        rows: rows.map((r: any) => [
          r.dimensionValues[0].value,
          Number(r.metricValues[0].value),
          Number(r.metricValues[1].value),
          Number((Number(r.metricValues[2].value) * 100).toFixed(1)),
          Math.round(Number(r.metricValues[3].value)),
        ]),
      },
    ];
  }
}
