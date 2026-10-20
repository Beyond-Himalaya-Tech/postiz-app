export const dynamic = 'force-dynamic';
import { Metadata } from 'next';
import { EngagementComponent } from '@gitroom/frontend/components/engagement/engagement.component';
import { isGeneralServerSide } from '@gitroom/helpers/utils/is.general.server.side';
export const metadata: Metadata = {
  title: `${isGeneralServerSide() ? 'Postiz' : 'Gitroom'} Engagement`,
  description: '',
};
export default async function Index() {
  return <EngagementComponent />;
}
