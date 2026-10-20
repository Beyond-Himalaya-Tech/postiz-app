import { Injectable } from '@nestjs/common';
import { WebsiteProvider } from '@gitroom/nestjs-libraries/integrations/website/website.interface';
import { SearchConsoleProvider } from '@gitroom/nestjs-libraries/integrations/website/providers/search-console.provider';
import { Ga4Provider } from '@gitroom/nestjs-libraries/integrations/website/providers/ga4.provider';
import { BingWebmasterProvider } from '@gitroom/nestjs-libraries/integrations/website/providers/bing-webmaster.provider';
import { YandexWebmasterProvider } from '@gitroom/nestjs-libraries/integrations/website/providers/yandex-webmaster.provider';

export const websiteProviderList: WebsiteProvider[] = [
  new Ga4Provider(),
  new SearchConsoleProvider(),
  new BingWebmasterProvider(),
  new YandexWebmasterProvider(),
];

@Injectable()
export class WebsiteManager {
  getAllProviders() {
    return websiteProviderList.map((p) => ({
      identifier: p.identifier,
      name: p.name,
      authType: p.authType,
    }));
  }

  getProvider(identifier: string): WebsiteProvider | undefined {
    return websiteProviderList.find((p) => p.identifier === identifier);
  }
}
