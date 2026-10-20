import { Injectable } from '@nestjs/common';
import { ContentProvider } from '@gitroom/nestjs-libraries/integrations/website/content/content.interface';
import { GithubContentProvider } from '@gitroom/nestjs-libraries/integrations/website/content/github.content.provider';

export const contentProviderList: ContentProvider[] = [
  new GithubContentProvider(),
];

@Injectable()
export class ContentManager {
  getProvider(identifier: string): ContentProvider | undefined {
    return contentProviderList.find((p) => p.identifier === identifier);
  }
}
