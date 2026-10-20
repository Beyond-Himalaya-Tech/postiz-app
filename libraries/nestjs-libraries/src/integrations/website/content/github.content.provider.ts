import {
  ContentArticle,
  ContentChange,
  ContentProvider,
  ContentSourceConfig,
} from '@gitroom/nestjs-libraries/integrations/website/content/content.interface';

const articleExtensions = ['.mdx', '.md'];

export class GithubContentProvider implements ContentProvider {
  identifier = 'github';
  name = 'GitHub';

  private async request(
    config: ContentSourceConfig,
    path: string,
    init?: RequestInit
  ) {
    const response = await fetch(
      `https://api.github.com/repos/${config.owner}/${config.repo}${path}`,
      {
        ...init,
        signal: AbortSignal.timeout(30000),
        headers: {
          Authorization: `Bearer ${config.token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        },
      }
    );

    if (!response.ok) {
      throw new Error(`GitHub ${response.status}: ${await response.text()}`);
    }

    return response.json();
  }

  // Branches and file paths keep their slashes, each segment is encoded
  private encodePath(path: string) {
    return path.split('/').map(encodeURIComponent).join('/');
  }

  private contentUrl(config: ContentSourceConfig, path: string) {
    return `/contents/${this.encodePath(path)}`;
  }

  async checkConnection(config: ContentSourceConfig) {
    try {
      const repo = await this.request(config, '');
      return !!repo?.permissions?.push;
    } catch (err) {
      return false;
    }
  }

  async listArticles(config: ContentSourceConfig): Promise<ContentArticle[]> {
    const { tree = [] } = await this.request(
      config,
      `/git/trees/${encodeURIComponent(config.branch)}?recursive=1`
    );

    const folder = config.contentPath.replace(/^\/+|\/+$/g, '');
    return tree
      .filter(
        (item: any) =>
          item.type === 'blob' &&
          (!folder || item.path.startsWith(`${folder}/`)) &&
          articleExtensions.some((ext) => item.path.endsWith(ext))
      )
      .map((item: any) => {
        const file = item.path.split('/').pop() as string;
        const name = file.replace(/\.mdx?$/, '');
        // Folder based posts (blog/my-post/index.mdx) use the folder name as slug
        const slug =
          name === 'index' || name === 'page'
            ? item.path.split('/').slice(-2, -1)[0] || name
            : name;
        return { path: item.path, slug };
      });
  }

  async readArticle(config: ContentSourceConfig, path: string) {
    const { content } = await this.request(
      config,
      `${this.contentUrl(config, path)}?ref=${encodeURIComponent(config.branch)}`
    );
    return Buffer.from(content, 'base64').toString('utf-8');
  }

  async proposeChange(config: ContentSourceConfig, change: ContentChange) {
    const { object } = await this.request(
      config,
      `/git/ref/heads/${this.encodePath(config.branch)}`
    );

    await this.request(config, '/git/refs', {
      method: 'POST',
      body: JSON.stringify({
        ref: `refs/heads/${change.branch}`,
        sha: object.sha,
      }),
    });

    // A failed commit or pull request must not leave an orphan branch behind
    try {
      // Updating an existing file needs its current sha
      const existing = await this.request(
        config,
        `${this.contentUrl(config, change.path)}?ref=${encodeURIComponent(
          config.branch
        )}`
      ).catch(() => null);

      await this.request(config, this.contentUrl(config, change.path), {
        method: 'PUT',
        body: JSON.stringify({
          message: change.title,
          content: Buffer.from(change.content, 'utf-8').toString('base64'),
          branch: change.branch,
          ...(existing?.sha ? { sha: existing.sha } : {}),
        }),
      });

      const { html_url } = await this.request(config, '/pulls', {
        method: 'POST',
        body: JSON.stringify({
          title: change.title,
          head: change.branch,
          base: config.branch,
          body: change.body,
        }),
      });

      return { prUrl: html_url };
    } catch (err) {
      await this.request(
        config,
        `/git/refs/heads/${this.encodePath(change.branch)}`,
        { method: 'DELETE' }
      ).catch(() => null);
      throw err;
    }
  }
}
