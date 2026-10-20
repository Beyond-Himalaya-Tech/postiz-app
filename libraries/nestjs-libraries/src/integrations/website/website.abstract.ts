import dayjs from 'dayjs';
import { AnalyticsData } from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';

export interface WebsiteMetric extends AnalyticsData {
  average?: boolean;
}

export class WebsiteRefreshToken extends Error {}

export abstract class WebsiteAbstract {
  // Days until a provider's data is complete, today is always partial
  protected dataDelay = 1;

  protected end() {
    return dayjs().subtract(this.dataDelay, 'day');
  }

  // Metrics load twice the requested range, so the previous period can be
  // compared with the current one.
  protected range(days: number, compare = true) {
    const end = this.end();
    return {
      startDate: end
        .subtract((compare ? days * 2 : days) - 1, 'day')
        .format('YYYY-MM-DD'),
      endDate: end.format('YYYY-MM-DD'),
    };
  }

  // Averages (CTR, position) compare in percentage points, like the analytics page.
  // inverse flips the sign for metrics where lower is better (search position).
  protected toMetric(
    label: string,
    points: Array<{ date: string; value: number }>,
    days: number,
    average = false,
    inverse = false
  ): WebsiteMetric {
    const split = this.end().subtract(days, 'day').format('YYYY-MM-DD');
    const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date));
    const current = sorted.filter((p) => p.date > split);
    const previous = sorted.filter((p) => p.date <= split);

    const sum = (list: typeof points) => {
      const total = list.reduce((acc, p) => acc + p.value, 0);
      return average && list.length ? total / list.length : total;
    };

    const currentTotal = sum(current);
    const previousTotal = sum(previous);
    const change = average
      ? currentTotal - previousTotal
      : previousTotal
      ? ((currentTotal - previousTotal) / previousTotal) * 100
      : 0;

    return {
      label,
      average,
      percentageChange: previous.length ? (inverse ? -change : change) : 0,
      data: current.map((p) => ({
        date: p.date,
        total: String(p.value),
      })),
    };
  }

  protected async request(url: string, init?: RequestInit) {
    const response = await fetch(url, init);
    if (response.status === 401) {
      throw new WebsiteRefreshToken(await response.text());
    }

    if (!response.ok) {
      throw new Error(await response.text());
    }

    return response.json();
  }
}
