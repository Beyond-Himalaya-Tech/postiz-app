export const dynamic = 'force-dynamic';
import { Metadata } from 'next';
import { WebsiteDashboardComponent } from '@gitroom/frontend/components/websites/website.dashboard.component';
import { isGeneralServerSide } from '@gitroom/helpers/utils/is.general.server.side';
export const metadata: Metadata = {
  title: `${isGeneralServerSide() ? 'Postiz' : 'Gitroom'} Website`,
  description: '',
};
export default async function Index(props: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await props.params;
  return <WebsiteDashboardComponent id={id} />;
}
