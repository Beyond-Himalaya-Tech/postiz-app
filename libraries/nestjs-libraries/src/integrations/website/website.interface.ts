import { AnalyticsData } from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';

export interface WebsiteAuthDetails {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
  name: string;
}

export interface WebsiteProperty {
  id: string;
  name: string;
}

export interface WebsiteTable {
  label: string;
  columns: string[];
  rows: Array<Array<string | number>>;
}

export interface WebsiteProvider {
  identifier: string;
  name: string;
  authType: 'oauth' | 'apikey';
  scopes: string[];
  generateAuthUrl?(): Promise<{ url: string; state: string }>;
  authenticate(params: {
    code?: string;
    apiKey?: string;
  }): Promise<WebsiteAuthDetails>;
  refreshToken?(refreshToken: string): Promise<WebsiteAuthDetails>;
  listProperties(accessToken: string): Promise<WebsiteProperty[]>;
  metrics(
    accessToken: string,
    externalId: string,
    days: number
  ): Promise<AnalyticsData[]>;
  tables(
    accessToken: string,
    externalId: string,
    days: number
  ): Promise<WebsiteTable[]>;
  // Larger datasets for the AI SEO analysis, falls back to tables when missing
  insightData?(
    accessToken: string,
    externalId: string,
    days: number
  ): Promise<WebsiteTable[]>;
}
