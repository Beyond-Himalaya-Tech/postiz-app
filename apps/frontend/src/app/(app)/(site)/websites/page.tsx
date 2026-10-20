export const dynamic = 'force-dynamic';
import { Metadata } from 'next';
import { WebsitesComponent } from '@gitroom/frontend/components/websites/websites.component';
import { isGeneralServerSide } from '@gitroom/helpers/utils/is.general.server.side';
export const metadata: Metadata = {
  title: `${isGeneralServerSide() ? 'Postiz' : 'Gitroom'} Websites`,
  description: '',
};
export default async function Index() {
  return <WebsitesComponent />;
}
