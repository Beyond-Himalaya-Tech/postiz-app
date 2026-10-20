export interface ContentSourceConfig {
  owner: string;
  repo: string;
  branch: string;
  contentPath: string;
  token: string;
}

export interface ContentArticle {
  path: string;
  slug: string;
}

export interface ContentChange {
  branch: string;
  path: string;
  content: string;
  title: string;
  body: string;
}

export interface ContentProvider {
  identifier: string;
  name: string;
  checkConnection(config: ContentSourceConfig): Promise<boolean>;
  listArticles(config: ContentSourceConfig): Promise<ContentArticle[]>;
  readArticle(config: ContentSourceConfig, path: string): Promise<string>;
  proposeChange(
    config: ContentSourceConfig,
    change: ContentChange
  ): Promise<{ prUrl: string }>;
}
