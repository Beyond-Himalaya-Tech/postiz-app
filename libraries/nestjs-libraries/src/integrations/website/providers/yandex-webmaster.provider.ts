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

const API = 'https://api.webmaster.yandex.net/v4';

export class YandexWebmasterProvider
  extends WebsiteAbstract
  implements WebsiteProvider
{
  identifier = 'yandex-webmaster';
  name = 'Yandex Webmaster';
  authType = 'oauth' as const;
  scopes = [] as string[];

  private get(accessToken: string, path: string) {
    return this.request(`${API}${path}`, {
      headers: { Authorization: `OAuth ${accessToken}` },
    });
  }

  private token(body: Record<string, string>) {
    return this.request('https://oauth.yandex.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        ...body,
        client_id: process.env.YANDEX_CLIENT_ID!,
        client_secret: process.env.YANDEX_CLIENT_SECRET!,
      }).toString(),
    });
  }

  async generateAuthUrl() {
    const state = makeSecureId(7);
    return {
      url: `https://oauth.yandex.com/authorize?${new URLSearchParams({
        response_type: 'code',
        client_id: process.env.YANDEX_CLIENT_ID!,
        redirect_uri: `${process.env.FRONTEND_URL}/websites/oauth/yandex-webmaster`,
        state,
      }).toString()}`,
      state,
    };
  }

  async authenticate(params: { code?: string }): Promise<WebsiteAuthDetails> {
    const { access_token, refresh_token, expires_in } = await this.token({
      grant_type: 'authorization_code',
      code: params.code!,
    });

    // The login needs the optional "login:info" permission, the Webmaster
    // user id is always available, so accounts never share a name
    const { login } = await this.request(
      'https://login.yandex.ru/info?format=json',
      { headers: { Authorization: `OAuth ${access_token}` } }
    ).catch(() => ({ login: '' }));
    const { user_id } = await this.get(access_token, '/user');

    return {
      accessToken: access_token,
      refreshToken: refresh_token,
      expiresIn: expires_in,
      name: login || `${this.name} ${user_id}`,
    };
  }

  async refreshToken(refreshToken: string): Promise<WebsiteAuthDetails> {
    const { access_token, refresh_token, expires_in } = await this.token({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    });

    return {
      accessToken: access_token,
      refreshToken: refresh_token || refreshToken,
      expiresIn: expires_in,
      name: this.name,
    };
  }

  // Host ids contain colons ("https:example.com:443"), so the user id and
  // host id are stored together as "userId|hostId"
  private host(externalId: string) {
    const [userId, hostId] = externalId.split('|');
    return `/user/${userId}/hosts/${encodeURIComponent(hostId)}`;
  }

  async listProperties(accessToken: string): Promise<WebsiteProperty[]> {
    const { user_id } = await this.get(accessToken, '/user');
    const { hosts = [] } = await this.get(accessToken, `/user/${user_id}/hosts`);

    return hosts
      .filter((p: any) => p.verified)
      .map((p: any) => ({
        id: `${user_id}|${p.host_id}`,
        name: p.unicode_host_url || p.ascii_host_url,
      }));
  }

  async metrics(
    accessToken: string,
    externalId: string,
    days: number
  ): Promise<WebsiteMetric[]> {
    const { startDate, endDate } = this.range(days);
    const { indicators = {} } = await this.get(
      accessToken,
      `${this.host(
        externalId
      )}/search-queries/all/history?query_indicator=TOTAL_CLICKS&query_indicator=TOTAL_SHOWS&date_from=${startDate}&date_to=${endDate}`
    );

    const points = (key: string) =>
      (indicators[key] || []).map((p: any) => ({
        date: p.date.slice(0, 10),
        value: p.value,
      }));

    return [
      this.toMetric('Clicks', points('TOTAL_CLICKS'), days),
      this.toMetric('Impressions', points('TOTAL_SHOWS'), days),
    ];
  }

  async tables(
    accessToken: string,
    externalId: string,
    days: number
  ): Promise<WebsiteTable[]> {
    const { startDate, endDate } = this.range(days, false);
    const [{ queries = [] }, summary] = await Promise.all([
      this.get(
        accessToken,
        `${this.host(
          externalId
        )}/search-queries/popular?order_by=TOTAL_CLICKS&query_indicator=TOTAL_CLICKS&query_indicator=TOTAL_SHOWS&query_indicator=AVG_SHOW_POSITION&date_from=${startDate}&date_to=${endDate}&limit=20`
      ),
      this.get(accessToken, `${this.host(externalId)}/summary`),
    ]);

    const problems = Object.values(summary.site_problems || {}).reduce(
      (acc: number, count: any) => acc + Number(count || 0),
      0
    );

    return [
      {
        label: 'Site Summary',
        columns: ['Metric', 'Value'],
        rows: [
          ['Site Quality Index (SQI)', summary.sqi ?? 0],
          ['Pages in search', summary.searchable_pages_count ?? 0],
          ['Excluded pages', summary.excluded_pages_count ?? 0],
          ['Site problems', problems],
        ],
      },
      {
        label: 'Top Queries',
        columns: ['Query', 'Clicks', 'Impressions', 'Position'],
        rows: queries.map((q: any) => [
          q.query_text,
          q.indicators.TOTAL_CLICKS,
          q.indicators.TOTAL_SHOWS,
          Number((q.indicators.AVG_SHOW_POSITION || 0).toFixed(1)),
        ]),
      },
    ];
  }
}
