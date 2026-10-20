'use client';

import { FC, useCallback, useState } from 'react';
import useSWR from 'swr';
import clsx from 'clsx';
import dayjs from 'dayjs';
import { FieldValues, FormProvider, useForm } from 'react-hook-form';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { Input } from '@gitroom/react/form/input';
import { Button } from '@gitroom/react/form/button';
import { LoadingComponent } from '@gitroom/frontend/components/layout/loading';
import { deleteDialog } from '@gitroom/react/helpers/delete.dialog';
import { AddEditModal } from '@gitroom/frontend/components/new-launch/add.edit.modal';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import { useIntegrationList } from '@gitroom/frontend/components/launches/helpers/use.integration.list';
import {
  swrOptions,
  useJson,
} from '@gitroom/frontend/components/websites/websites.component';

interface ContentSource {
  owner: string;
  repo: string;
  branch: string;
  contentPath: string;
  urlPrefix: string;
}

interface Opportunity {
  type: 'new_article' | 'update_article';
  title: string;
  reason: string;
  targetQueries: string[];
  filePath: string;
  priority: number;
}

interface ContentTask {
  id: string;
  type: 'new' | 'update';
  title: string;
  filePath: string;
  url: string;
  prUrl: string;
  createdAt: string;
}

const useContentSource = (websiteId: string) => {
  const load = useJson();
  return useSWR<{ source: ContentSource | null }>(
    `/websites/${websiteId}/content-source`,
    load,
    swrOptions
  );
};

// Loaded only after "Analyse", the AI call is slow and costs tokens
const useInsights = (websiteId: string, days: number, enabled: boolean) => {
  const load = useJson();
  return useSWR<Opportunity[]>(
    enabled ? `/websites/${websiteId}/insights?date=${days}` : null,
    load,
    swrOptions
  );
};

const useContentTasks = (websiteId: string) => {
  const load = useJson();
  return useSWR<ContentTask[]>(`/websites/${websiteId}/content`, load, swrOptions);
};

const ContentSourceModal: FC<{
  websiteId: string;
  current?: ContentSource | null;
  update: () => void;
}> = ({ websiteId, current, update }) => {
  const fetch = useFetch();
  const modal = useModals();
  const toaster = useToaster();
  const t = useT();
  const [loading, setLoading] = useState(false);
  const methods = useForm({
    mode: 'onChange',
    defaultValues: {
      owner: current?.owner || '',
      repo: current?.repo || '',
      branch: current?.branch || 'main',
      contentPath: current?.contentPath || 'content/blog',
      urlPrefix: current?.urlPrefix || '/blog/',
      token: '',
    },
  });

  const submit = useCallback(
    async (data: FieldValues) => {
      setLoading(true);
      const response = await fetch(`/websites/${websiteId}/content-source`, {
        method: 'PUT',
        body: JSON.stringify({ ...data, providerIdentifier: 'github' }),
      });
      setLoading(false);

      if (!response.ok) {
        const { message } = await response.json();
        methods.setError('token', {
          message: Array.isArray(message) ? message.join(', ') : message,
        });
        return;
      }

      toaster.show(
        t('repository_connected', 'Repository connected'),
        'success'
      );
      modal.closeAll();
      update();
    },
    [fetch, websiteId, t, update, methods, toaster, modal]
  );

  return (
    <FormProvider {...methods}>
      <form
        className="gap-[8px] flex flex-col"
        onSubmit={methods.handleSubmit(submit)}
      >
        <div className="grid grid-cols-2 gap-[8px]">
          <Input label={t('github_owner', 'GitHub owner')} name="owner" />
          <Input label={t('repository', 'Repository')} name="repo" />
          <Input label={t('base_branch', 'Base branch')} name="branch" />
          <Input
            label={t('content_folder', 'Content folder')}
            name="contentPath"
          />
        </div>
        <Input label={t('url_prefix', 'Article URL prefix')} name="urlPrefix" />
        <Input
          label={t('github_token', 'Fine-grained token (Contents + Pull requests: write)')}
          name="token"
          type="password"
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

export const ContentSourceBar: FC<{ websiteId: string }> = ({ websiteId }) => {
  const t = useT();
  const fetch = useFetch();
  const modals = useModals();
  const { data: content, mutate } = useContentSource(websiteId);
  const data = content?.source;

  const edit = useCallback(() => {
    modals.openModal({
      title: t('content_repository', 'Content repository'),
      withCloseButton: false,
      children: (
        <ContentSourceModal websiteId={websiteId} current={data} update={mutate} />
      ),
    });
  }, [modals, t, websiteId, data, mutate]);

  const disconnect = useCallback(async () => {
    if (
      !(await deleteDialog(
        t(
          'are_you_sure_you_want_to_disconnect_this_repository',
          'Are you sure you want to disconnect this repository?'
        )
      ))
    ) {
      return;
    }

    await fetch(`/websites/${websiteId}/content-source`, { method: 'DELETE' });
    mutate();
  }, [fetch, t, websiteId, mutate]);

  return (
    <div className="flex items-center gap-[12px] p-[16px] border border-newTableBorder rounded-[12px]">
      <div className="flex-1 flex flex-col">
        <div className="text-[15px] font-[600]">
          {t('content_repository', 'Content repository')}
        </div>
        <div className="text-[13px] text-textItemBlur">
          {data
            ? `github.com/${data.owner}/${data.repo} · ${data.branch} · ${
                data.contentPath || '/'
              }`
            : t(
                'connect_repository_description',
                'Connect the GitHub repository of your blog to create and update articles as pull requests.'
              )}
        </div>
      </div>
      {data && (
        <div
          onClick={disconnect}
          className="text-[13px] text-red-400 cursor-pointer hover:underline"
        >
          {t('disconnect', 'Disconnect')}
        </div>
      )}
      <Button onClick={edit}>
        {data ? t('edit', 'Edit') : t('connect', 'Connect')}
      </Button>
    </div>
  );
};

const OpportunityCard: FC<{
  websiteId: string;
  opportunity: Opportunity;
  onCreated: () => void;
}> = ({ websiteId, opportunity, onCreated }) => {
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();
  const [loading, setLoading] = useState(false);
  const [prUrl, setPrUrl] = useState('');

  const create = useCallback(async () => {
    setLoading(true);
    const response = await fetch(`/websites/${websiteId}/content`, {
      method: 'POST',
      body: JSON.stringify(opportunity),
    });
    const data = await response.json();
    setLoading(false);

    if (!response.ok) {
      toaster.show(data.message, 'warning');
      return;
    }

    setPrUrl(data.prUrl);
    toaster.show(
      t('pull_request_created', 'Pull request created'),
      'success'
    );
    onCreated();
  }, [fetch, websiteId, opportunity, toaster, t, onCreated]);

  const isUpdate = opportunity.type === 'update_article';

  return (
    <div className="flex flex-col gap-[10px] p-[16px] bg-newTableHeader border border-newTableBorder rounded-[12px]">
      <div className="flex items-center gap-[8px]">
        <span
          className={clsx(
            'text-[12px] px-[8px] py-[2px] rounded-[6px]',
            isUpdate ? 'bg-[#1d9bf0]/20' : 'bg-[#32d583]/20'
          )}
        >
          {isUpdate
            ? t('update_article', 'Update article')
            : t('new_article', 'New article')}
        </span>
        <span className="text-[12px] text-textItemBlur">
          {t('priority', 'Priority')} {opportunity.priority}/5
        </span>
      </div>
      <div className="text-[16px] font-[600]">{opportunity.title}</div>
      {isUpdate && (
        <div className="text-[12px] text-textItemBlur">{opportunity.filePath}</div>
      )}
      <div className="text-[14px]">{opportunity.reason}</div>
      <div className="flex flex-wrap gap-[6px]">
        {opportunity.targetQueries.map((query) => (
          <span
            key={query}
            className="text-[12px] px-[8px] py-[2px] rounded-[6px] border border-newTableBorder"
          >
            {query}
          </span>
        ))}
      </div>
      <div>
        {prUrl ? (
          <a
            href={prUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[14px] underline"
          >
            {t('view_pull_request', 'View pull request')}
          </a>
        ) : (
          <Button loading={loading} onClick={create}>
            {isUpdate
              ? t('update_article', 'Update article')
              : t('write_article', 'Write article')}
          </Button>
        )}
      </div>
    </div>
  );
};

export const WebsiteInsightsComponent: FC<{
  websiteId: string;
  days: number;
}> = ({ websiteId, days }) => {
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();
  const [enabled, setEnabled] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const { data, error, isLoading, mutate } = useInsights(
    websiteId,
    days,
    enabled
  );
  const { mutate: reloadTasks } = useContentTasks(websiteId);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    const response = await fetch(
      `/websites/${websiteId}/insights?date=${days}&refresh=true`
    );
    const result = await response.json();
    setRefreshing(false);
    if (!response.ok) {
      toaster.show(result.message, 'warning');
      return;
    }

    mutate(result, { revalidate: false });
  }, [fetch, websiteId, days, mutate, toaster]);

  if (!enabled) {
    return (
      <div className="flex flex-col items-center gap-[12px] py-[32px] text-center">
        <div className="text-[14px] text-textItemBlur max-w-[480px]">
          {t(
            'insights_description',
            'AI analyses your Search Console and Google Analytics data and suggests new articles to write and existing articles to improve.'
          )}
        </div>
        <Button onClick={() => setEnabled(true)}>
          {t('analyse_website', 'Analyse website')}
        </Button>
      </div>
    );
  }

  if (isLoading || refreshing) {
    return (
      <div className="flex flex-col items-center gap-[12px] py-[32px]">
        <LoadingComponent />
        <div className="text-[13px] text-textItemBlur">
          {t('analysing_website', 'Analysing, this can take a minute...')}
        </div>
      </div>
    );
  }

  if (error) {
    return <div className="text-[14px] text-red-400">{error.message}</div>;
  }

  return (
    <div className="flex flex-col gap-[16px]">
      <div>
        <Button className="!bg-btnSimple !text-btnText" onClick={refresh}>
          {t('analyse_again', 'Analyse again')}
        </Button>
      </div>
      {!data?.length && (
        <div className="text-[14px] text-textItemBlur">
          {t('no_opportunities_found', 'No opportunities found for this period.')}
        </div>
      )}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-[16px]">
        {data?.map((opportunity, index) => (
          <OpportunityCard
            key={`${opportunity.title}-${index}`}
            websiteId={websiteId}
            opportunity={opportunity}
            onCreated={reloadTasks}
          />
        ))}
      </div>
    </div>
  );
};

export const WebsiteContentHistoryComponent: FC<{ websiteId: string }> = ({
  websiteId,
}) => {
  const t = useT();
  const fetch = useFetch();
  const modal = useModals();
  const toaster = useToaster();
  const [promoting, setPromoting] = useState('');
  const { data, isLoading } = useContentTasks(websiteId);
  const { data: channels } = useIntegrationList();

  const promote = useCallback(
    (task: ContentTask) => async () => {
      setPromoting(task.id);
      const response = await fetch(`/websites/content/${task.id}/promote`, {
        method: 'POST',
      });
      const result = await response.json();
      setPromoting('');

      if (!response.ok) {
        toaster.show(result.message, 'warning');
        return;
      }

      const integrations = (channels || []).filter(
        (p: any) => !p.disabled && !p.inBetweenSteps && !p.refreshNeeded
      );

      modal.openModal({
        id: 'add-edit-modal',
        closeOnClickOutside: false,
        removeLayout: true,
        closeOnEscape: false,
        withCloseButton: false,
        askClose: true,
        fullScreen: true,
        classNames: {
          modal: 'w-[100%] max-w-[1400px] text-textColor',
        },
        children: (
          <AddEditModal
            allIntegrations={integrations}
            integrations={integrations}
            mutate={() => {}}
            date={dayjs().add(1, 'hour')}
            reopenModal={() => ({})}
            onlyValues={[{ id: makeId(10), content: result.content }]}
          />
        ),
        size: '80%',
      });
    },
    [fetch, modal, toaster, channels]
  );

  if (isLoading) {
    return <LoadingComponent />;
  }

  if (!data?.length) {
    return (
      <div className="text-[14px] text-textItemBlur py-[16px]">
        {t(
          'no_content_yet',
          'No articles yet. Use Insights to create your first pull request.'
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col bg-newTableHeader border border-newTableBorder rounded-[12px] overflow-x-auto">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="text-textItemBlur">
            <th className="px-[16px] py-[8px] font-normal text-start">
              {t('article', 'Article')}
            </th>
            <th className="px-[16px] py-[8px] font-normal text-start">
              {t('type', 'Type')}
            </th>
            <th className="px-[16px] py-[8px] font-normal text-start">
              {t('date', 'Date')}
            </th>
            <th className="px-[16px] py-[8px]" />
          </tr>
        </thead>
        <tbody>
          {data.map((task) => (
            <tr key={task.id} className="border-t border-newTableBorder">
              <td className="px-[16px] py-[8px]">
                <div className="font-[500]">{task.title}</div>
                <div className="text-textItemBlur">{task.filePath}</div>
              </td>
              <td className="px-[16px] py-[8px]">
                {task.type === 'update'
                  ? t('update_article', 'Update article')
                  : t('new_article', 'New article')}
              </td>
              <td className="px-[16px] py-[8px]">
                {dayjs(task.createdAt).format('DD/MM/YYYY')}
              </td>
              <td className="px-[16px] py-[8px]">
                <div className="flex items-center justify-end gap-[12px]">
                  <a
                    href={task.prUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline"
                  >
                    {t('pull_request', 'Pull request')}
                  </a>
                  <Button
                    loading={promoting === task.id}
                    onClick={promote(task)}
                  >
                    {t('promote', 'Promote')}
                  </Button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
