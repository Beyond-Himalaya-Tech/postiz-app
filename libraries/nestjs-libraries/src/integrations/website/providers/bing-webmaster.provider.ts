import dayjs from 'dayjs';
import {
  WebsiteAuthDetails,
  WebsiteProvider,
  WebsiteTable,
} from '@gitroom/nestjs-libraries/integrations/website/website.interface';
import {
  WebsiteAbstract,
  WebsiteMetric,
} from '@gitroom/nestjs-libraries/integrations/website/website.abstract';

export class BingWebmasterProvider
  extends WebsiteAbstract
  implements WebsiteProvider
{
  identifier = 'bing-webmaster';
  name = 'Bing Webmaster Tools';
  authType = 'apikey' as const;
  scopes = [] as string[];

  private call(apiKey: string, method: string, siteUrl?: string) {
    return this.request(
      `https://ssl.bing.com/webmaster/api.svc/json/${method}?apikey=${encodeURIComponent(
        apiKey
      )}${siteUrl ? `&siteUrl=${encodeURIComponent(siteUrl)}` : ''}`
    );
  }

  // Bing returns WCF dates like "/Date(1700000000000-0700)/"
  private date(value: string) {
    return dayjs(Number(value.match(/\d+/)?.[0])).format('YYYY-MM-DD');
  }

  async authenticate(params: { apiKey?: string }): Promise<WebsiteAuthDetails> {
    await this.call(params.apiKey!, 'GetUserSites');
    // The name tells keys apart, so a second key does not replace the first source
    return {
      accessToken: params.apiKey!,
      name: `${this.name} (…${params.apiKey!.slice(-4)})`,
    };
  }

  async listProperties(apiKey: string) {
    const { d = [] } = await this.call(apiKey, 'GetUserSites');
    return d
      .filter((p: any) => p.IsVerified)
      .map((p: any) => ({ id: p.Url, name: p.Url }));
  }

  async metrics(
    apiKey: string,
    siteUrl: string,
    days: number
  ): Promise<WebsiteMetric[]> {
    const { d = [] } = await this.call(
      apiKey,
      'GetRankAndTrafficStats',
      siteUrl
    );

    const { startDate, endDate } = this.range(days);
    const rows = d
      .map((r: any) => ({ ...r, date: this.date(r.Date) }))
      .filter((r: any) => r.date >= startDate && r.date <= endDate);

    return [
      this.toMetric(
        'Clicks',
        rows.map((r: any) => ({ date: r.date, value: r.Clicks })),
        days
      ),
      this.toMetric(
        'Impressions',
        rows.map((r: any) => ({ date: r.date, value: r.Impressions })),
        days
      ),
    ];
  }

  async tables(
    apiKey: string,
    siteUrl: string,
    days: number
  ): Promise<WebsiteTable[]> {
    const [queries, pages] = await Promise.all([
      this.call(apiKey, 'GetQueryStats', siteUrl),
      this.call(apiKey, 'GetPageStats', siteUrl),
    ]);

    const { startDate, endDate } = this.range(days, false);

    // Bing returns one row per item per week, so aggregate the range ourselves
    const top = (rows: any[] = []) => {
      const totals = new Map<string, { clicks: number; impressions: number }>();
      for (const row of rows) {
        const date = this.date(row.Date);
        if (date < startDate || date > endDate) {
          continue;
        }
        const current = totals.get(row.Query) || { clicks: 0, impressions: 0 };
        totals.set(row.Query, {
          clicks: current.clicks + row.Clicks,
          impressions: current.impressions + row.Impressions,
        });
      }

      return [...totals.entries()]
        .sort((a, b) => b[1].clicks - a[1].clicks)
        .slice(0, 20)
        .map(([key, value]) => [key, value.clicks, value.impressions]);
    };

    return [
      {
        label: 'Top Queries',
        columns: ['Query', 'Clicks', 'Impressions'],
        rows: top(queries.d),
      },
      {
        label: 'Top Pages',
        columns: ['Page', 'Clicks', 'Impressions'],
        rows: top(pages.d),
      },
    ];
  }
}
