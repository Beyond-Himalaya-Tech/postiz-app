'use client';

import { FC, useCallback, useMemo, useState } from 'react';
import useSWR from 'swr';
import clsx from 'clsx';
import dayjs from 'dayjs';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { Button } from '@gitroom/react/form/button';
import { LoadingComponent } from '@gitroom/frontend/components/layout/loading';
import { useIntegrationList } from '@gitroom/frontend/components/launches/helpers/use.integration.list';
import {
  swrOptions,
  useJson,
} from '@gitroom/frontend/components/websites/websites.component';
import {
  EngagementSetting,
  EngagementSettingsModal,
} from '@gitroom/frontend/components/engagement/engagement.settings.component';

interface EngagementItem {
  id: string;
  integrationId: string;
  kind: 'comment' | 'mention' | 'keyword' | 'message';
  authorName: string;
  authorHandle: string;
  authorUrl: string | null;
  content: string;
  url: string | null;
  receivedAt: string;
  status: 'new' | 'drafted' | 'sent' | 'dismissed' | 'skipped';
  draft: string | null;
  sentAt: string | null;
  isLead: boolean;
  leadReason: string | null;
  leadSyncedAt: string | null;
}

const useEngagementProviders = () => {
  const load = useJson();
  return useSWR<string[]>('/engagement/providers', load, swrOptions);
};

const useEngagementSettings = () => {
  const load = useJson();
  return useSWR<EngagementSetting[]>('/engagement/settings', load, swrOptions);
};

const useEngagementItems = (query: string) => {
  const load = useJson();
  return useSWR<EngagementItem[]>(`/engagement/items?${query}`, load, {
    ...swrOptions,
    refreshInterval: 60000,
  });
};

const ItemCard: FC<{
  item: EngagementItem;
  channel?: { name: string; picture: string };
  update: () => void;
}> = ({ item, channel, update }) => {
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();
  const [draft, setDraft] = useState(item.draft || '');
  const [loading, setLoading] = useState('');

  const call = useCallback(
    async (action: string, init: RequestInit, success?: string) => {
      setLoading(action);
      const response = await fetch(`/engagement/items/${item.id}/${action}`, init);
      const data = await response.json().catch(() => ({}));
      setLoading('');
      if (!response.ok) {
        toaster.show(data.message, 'warning');
        return null;
      }

      if (success) {
        toaster.show(success, 'success');
      }
      return data;
    },
    [fetch, item.id, toaster]
  );

  const send = useCallback(async () => {
    // Save the edited reply first, the backend sends what is stored
    if (draft !== item.draft) {
      const saved = await call('draft', {
        method: 'PUT',
        body: JSON.stringify({ draft }),
      });
      if (!saved) {
        return;
      }
    }

    if (await call('send', { method: 'POST' }, t('reply_sent', 'Reply sent'))) {
      update();
    }
  }, [call, draft, item.draft, t, update]);

  const regenerate = useCallback(async () => {
    const data = await call('regenerate', { method: 'POST' });
    if (data) {
      setDraft(data.draft);
    }
  }, [call]);

  const sendToCrm = useCallback(async () => {
    if (
      await call(
        'crm',
        { method: 'POST' },
        t('lead_sent_to_crm', 'Lead sent to HubSpot')
      )
    ) {
      update();
    }
  }, [call, t, update]);

  const dismiss = useCallback(async () => {
    if (await call('dismiss', { method: 'POST' })) {
      update();
    }
  }, [call, update]);

  const done = item.status === 'sent' || item.status === 'dismissed';
  const skipped = item.status === 'skipped';

  return (
    <div className="flex flex-col gap-[10px] p-[16px] bg-newTableHeader border border-newTableBorder rounded-[12px]">
      <div className="flex items-center gap-[8px]">
        {channel?.picture && (
          <img
            src={channel.picture}
            className="w-[24px] h-[24px] rounded-full"
            alt=""
          />
        )}
        <div className="flex-1 flex flex-col">
          <div className="text-[14px] font-[600]">
            {item.authorUrl ? (
              <a href={item.authorUrl} target="_blank" rel="noopener noreferrer">
                {item.authorName}
              </a>
            ) : (
              item.authorName
            )}
          </div>
          <div className="text-[12px] text-textItemBlur">
            {channel?.name} · {dayjs(item.receivedAt).format('DD/MM/YYYY HH:mm')}
          </div>
        </div>
        <span className="text-[12px] px-[8px] py-[2px] rounded-[6px] border border-newTableBorder">
          {item.kind === 'keyword'
            ? t('keyword', 'Keyword')
            : t('comment', 'Comment')}
        </span>
        {item.isLead && (
          <span className="text-[12px] px-[8px] py-[2px] rounded-[6px] bg-[#32d583]/20">
            {t('lead', 'Lead')}
          </span>
        )}
      </div>

      <div className="text-[14px] whitespace-pre-wrap">{item.content}</div>
      {item.url && (
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[12px] underline text-textItemBlur"
        >
          {t('open_original', 'Open original')}
        </a>
      )}
      {item.isLead && item.leadReason && (
        <div className="text-[12px] text-textItemBlur">{item.leadReason}</div>
      )}
      <div className="text-[12px]">
        {item.leadSyncedAt ? (
          <span className="text-textItemBlur">
            {t('in_crm', 'Added to HubSpot')}
          </span>
        ) : (
          <span
            onClick={loading ? undefined : sendToCrm}
            className="cursor-pointer underline"
          >
            {loading === 'crm'
              ? t('sending', 'Sending...')
              : t('send_to_crm', 'Send to CRM')}
          </span>
        )}
      </div>
      {skipped && (
        <div className="text-[12px] text-textItemBlur">
          {t(
            'engagement_skipped',
            'The AI thinks this needs no reply (spam or off-topic), you can still reply.'
          )}
        </div>
      )}

      {done ? (
        <div className="text-[13px] text-textItemBlur">
          {item.status === 'sent'
            ? `${t('replied', 'Replied')}: ${item.draft}`
            : t('dismissed', 'Dismissed')}
        </div>
      ) : (
        <>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
            placeholder={t('write_a_reply', 'Write a reply...')}
            className="bg-newBgColorInner border border-newTableBorder rounded-[8px] p-[10px] text-[14px] outline-none"
          />
          <div className="flex gap-[8px]">
            <Button
              loading={loading === 'send' || loading === 'draft'}
              disabled={!draft.trim()}
              onClick={send}
            >
              {t('send_reply', 'Send reply')}
            </Button>
            <Button
              className="!bg-btnSimple !text-btnText"
              loading={loading === 'regenerate'}
              onClick={regenerate}
            >
              {t('regenerate', 'Regenerate')}
            </Button>
            <Button
              className="!bg-btnSimple !text-btnText"
              loading={loading === 'dismiss'}
              onClick={dismiss}
            >
              {t('dismiss', 'Dismiss')}
            </Button>
          </div>
        </>
      )}
    </div>
  );
};

export const EngagementComponent = () => {
  const t = useT();
  const fetch = useFetch();
  const modals = useModals();
  const toaster = useToaster();
  const [tab, setTab] = useState<'inbox' | 'leads' | 'sent' | 'dismissed'>(
    'inbox'
  );
  const [integrationId, setIntegrationId] = useState('');
  const [checking, setChecking] = useState('');
  const { data: integrations, isLoading } = useIntegrationList();
  const { data: providers } = useEngagementProviders();
  const { data: settings, mutate: reloadSettings } = useEngagementSettings();

  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (tab === 'inbox') params.set('status', 'open');
    if (tab === 'sent') params.set('status', 'sent');
    if (tab === 'dismissed') params.set('status', 'closed');
    if (tab === 'leads') params.set('leads', 'true');
    if (integrationId) params.set('integrationId', integrationId);
    return params.toString();
  }, [tab, integrationId]);
  const { data: items, isLoading: loadingItems, mutate } =
    useEngagementItems(query);

  const channels = useMemo(
    () =>
      (integrations || []).filter(
        (p: any) => !p.disabled && providers?.includes(p.identifier)
      ),
    [integrations, providers]
  );

  const openSettings = useCallback(
    (channel: any) => () => {
      modals.openModal({
        title: `${t('engagement_settings', 'Engagement settings')} · ${
          channel.name
        }`,
        withCloseButton: false,
        children: (
          <EngagementSettingsModal
            integrationId={channel.id}
            current={settings?.find((s) => s.integrationId === channel.id)}
            update={reloadSettings}
          />
        ),
      });
    },
    [modals, t, settings, reloadSettings]
  );

  const checkNow = useCallback(
    (id: string) => async () => {
      setChecking(id);
      const response = await fetch(`/engagement/settings/${id}/check`, {
        method: 'POST',
      });
      setChecking('');
      if (!response.ok) {
        const { message } = await response.json();
        toaster.show(message, 'warning');
        return;
      }

      reloadSettings();
      mutate();
    },
    [fetch, toaster, reloadSettings, mutate]
  );

  const tabs = [
    { key: 'inbox' as const, label: t('inbox', 'Inbox') },
    { key: 'leads' as const, label: t('leads', 'Leads') },
    { key: 'sent' as const, label: t('sent', 'Sent') },
    { key: 'dismissed' as const, label: t('dismissed', 'Dismissed') },
  ];

  if (isLoading) {
    return (
      <div className="bg-newBgColorInner flex flex-1 items-center justify-center">
        <LoadingComponent />
      </div>
    );
  }

  return (
    <div className="bg-newBgColorInner flex flex-1 gap-[20px] p-[20px] mobile:flex-col">
      <div className="w-[280px] mobile:w-full flex flex-col gap-[12px]">
        <h2 className="text-[20px] font-[600]">
          {t('engagement', 'Engagement')}
        </h2>
        <div
          onClick={() => setIntegrationId('')}
          className={clsx(
            'px-[12px] py-[8px] rounded-[8px] cursor-pointer text-[14px]',
            !integrationId ? 'bg-boxHover font-[600]' : 'hover:bg-boxHover'
          )}
        >
          {t('all_channels', 'All channels')}
        </div>
        {channels.map((channel: any) => {
          const setting = settings?.find((s) => s.integrationId === channel.id);
          return (
            <div
              key={channel.id}
              className={clsx(
                'flex flex-col gap-[6px] px-[12px] py-[8px] rounded-[8px]',
                integrationId === channel.id ? 'bg-boxHover' : 'hover:bg-boxHover'
              )}
            >
              <div
                onClick={() => setIntegrationId(channel.id)}
                className="flex items-center gap-[8px] cursor-pointer"
              >
                <img
                  src={channel.picture}
                  className="w-[24px] h-[24px] rounded-full"
                  alt=""
                />
                <div className="flex-1 text-[14px] truncate">{channel.name}</div>
                <span
                  className={clsx(
                    'w-[8px] h-[8px] rounded-full',
                    setting?.active ? 'bg-[#32d583]' : 'bg-newTableBorder'
                  )}
                />
              </div>
              <div className="flex gap-[12px] text-[12px] text-textItemBlur">
                <span
                  onClick={openSettings(channel)}
                  className="cursor-pointer hover:underline"
                >
                  {t('settings', 'Settings')}
                </span>
                {setting?.active && (
                  <span
                    onClick={checkNow(channel.id)}
                    className="cursor-pointer hover:underline"
                  >
                    {checking === channel.id
                      ? t('checking', 'Checking...')
                      : t('check_now', 'Check now')}
                  </span>
                )}
              </div>
            </div>
          );
        })}
        {!channels.length && (
          <div className="text-[13px] text-textItemBlur">
            {t(
              'engagement_no_channels',
              'Connect Facebook, Instagram, Threads, YouTube, LinkedIn Page, X, Reddit, Bluesky or Mastodon to start.'
            )}
          </div>
        )}
      </div>

      <div className="flex-1 flex flex-col gap-[16px]">
        <div className="flex gap-[8px] border-b border-newTableBorder">
          {tabs.map((p) => (
            <div
              key={p.key}
              onClick={() => setTab(p.key)}
              className={clsx(
                'px-[12px] py-[8px] text-[14px] cursor-pointer -mb-px border-b-2',
                tab === p.key
                  ? 'border-btnPrimary font-[600]'
                  : 'border-transparent text-textItemBlur'
              )}
            >
              {p.label}
            </div>
          ))}
        </div>

        {loadingItems ? (
          <LoadingComponent />
        ) : !items?.length ? (
          <div className="text-[14px] text-textItemBlur py-[24px]">
            {t(
              'engagement_empty',
              'Nothing here yet. Turn on monitoring for a channel in its settings, new comments and keyword matches arrive every 15 minutes with a suggested reply.'
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-[12px]">
            {items.map((item) => (
              <ItemCard
                key={item.id}
                item={item}
                channel={integrations?.find((p: any) => p.id === item.integrationId)}
                update={mutate}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
