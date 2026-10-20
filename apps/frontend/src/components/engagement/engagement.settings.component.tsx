'use client';

import { FC, useCallback, useState } from 'react';
import { FieldValues, FormProvider, useForm } from 'react-hook-form';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { Input } from '@gitroom/react/form/input';
import { Textarea } from '@gitroom/react/form/textarea';
import { Checkbox } from '@gitroom/react/form/checkbox';
import { Button } from '@gitroom/react/form/button';

export interface EngagementSetting {
  integrationId: string;
  active: boolean;
  comments: boolean;
  messages: boolean;
  keywords: string[];
  brandContext: string | null;
  lastCheckedAt: string | null;
}

export const EngagementSettingsModal: FC<{
  integrationId: string;
  current?: EngagementSetting;
  update: () => void;
}> = ({ integrationId, current, update }) => {
  const fetch = useFetch();
  const modal = useModals();
  const toaster = useToaster();
  const t = useT();
  const [loading, setLoading] = useState(false);
  const methods = useForm({
    mode: 'onChange',
    defaultValues: {
      active: current?.active ?? true,
      comments: current?.comments ?? true,
      messages: current?.messages ?? false,
      keywords: (current?.keywords || []).join(', '),
      brandContext: current?.brandContext || '',
    },
  });

  const submit = useCallback(
    async (data: FieldValues) => {
      setLoading(true);
      const response = await fetch(`/engagement/settings/${integrationId}`, {
        method: 'PUT',
        body: JSON.stringify({
          active: !!data.active,
          comments: !!data.comments,
          messages: !!data.messages,
          keywords: String(data.keywords || '')
            .split(',')
            .map((k) => k.trim())
            .filter(Boolean),
          brandContext: data.brandContext,
        }),
      });
      setLoading(false);

      if (!response.ok) {
        const { message } = await response.json();
        toaster.show(
          Array.isArray(message) ? message.join(', ') : message,
          'warning'
        );
        return;
      }

      toaster.show(t('settings_saved', 'Settings saved'), 'success');
      modal.closeAll();
      update();
    },
    [fetch, integrationId, toaster, t, modal, update]
  );

  return (
    <FormProvider {...methods}>
      <form
        className="gap-[12px] flex flex-col"
        onSubmit={methods.handleSubmit(submit)}
      >
        <Checkbox
          name="active"
          label={t('engagement_active', 'Monitor this channel')}
        />
        <Checkbox
          name="comments"
          label={t(
            'engagement_comments',
            'Collect comments on posts published by Postiz'
          )}
        />
        <Checkbox
          name="messages"
          label={t(
            'engagement_messages',
            'Collect direct messages (Facebook and Instagram, needs ENGAGEMENT_MESSAGES=true and a reconnect)'
          )}
        />
        <Input
          label={t('engagement_keywords', 'Keywords to monitor (comma separated)')}
          name="keywords"
          placeholder="social media scheduler, postiz alternative"
        />
        <Textarea
          label={t(
            'engagement_brand_context',
            'About your brand (used to write replies)'
          )}
          name="brandContext"
        />
        <div>
          <Button loading={loading} type="submit">
            {t('save', 'Save')}
          </Button>
        </div>
      </form>
    </FormProvider>
  );
};
