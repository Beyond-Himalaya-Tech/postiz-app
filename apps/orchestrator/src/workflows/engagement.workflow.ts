import {
  continueAsNew,
  proxyActivities,
  sleep,
  workflowInfo,
} from '@temporalio/workflow';
import { EngagementActivity } from '@gitroom/orchestrator/activities/engagement.activity';

const { collectEngagement } = proxyActivities<EngagementActivity>({
  startToCloseTimeout: '15 minute',
  taskQueue: 'main',
  retry: {
    maximumAttempts: 2,
    backoffCoefficient: 1,
    initialInterval: '2 minutes',
  },
});

// Reads comments and keyword matches every 15 minutes, replies are only
// sent from the inbox after a person approves them
export async function engagementWorkflow({
  integrationId,
}: {
  integrationId: string;
}) {
  let loops = 0;
  while (true) {
    try {
      await collectEngagement(integrationId);
    } catch (err) {}

    await sleep(900000);

    // Keep the history small
    if (++loops >= 96 || workflowInfo().historyLength > 1000) {
      return await continueAsNew<typeof engagementWorkflow>({ integrationId });
    }
  }
}
