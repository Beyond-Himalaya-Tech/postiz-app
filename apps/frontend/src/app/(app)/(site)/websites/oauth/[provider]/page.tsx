export const dynamic = 'force-dynamic';
import { WebsiteOAuthComponent } from '@gitroom/frontend/components/websites/website.oauth.component';

export default async function Index(props: {
  params: Promise<{ provider: string }>;
  searchParams: Promise<{ code?: string; state?: string; error?: string }>;
}) {
  const { provider } = await props.params;
  const searchParams = await props.searchParams;
  return (
    <WebsiteOAuthComponent provider={provider} searchParams={searchParams} />
  );
}
