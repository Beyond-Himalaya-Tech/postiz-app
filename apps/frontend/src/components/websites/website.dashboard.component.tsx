'use client';

import { FC, useCallback, useMemo, useState } from 'react';
import useSWR from 'swr';
import clsx from 'clsx';
import Link from 'next/link';
import { FieldValues, FormProvider, useForm } from 'react-hook-form';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { Input } from '@gitroom/react/form/input';
import { Button } from '@gitroom/react/form/button';
import { Select } from '@gitroom/react/form/select';
import { LoadingComponent } from '@gitroom/frontend/components/layout/loading';
import { AnalyticsCard } from '@gitroom/frontend/components/platform-analytics/render.analytics';
import { deleteDialog } from '@gitroom/react/helpers/delete.dialog';
import {
  swrOptions,
  useJson,
  WebsiteSource,
} from '@gitroom/frontend/components/websites/websites.component';
import {
  ContentSourceBar,
  WebsiteContentHistoryComponent,
  WebsiteInsightsComponent,
} from '@gitroom/frontend/components/websites/website.content.component';

interface Provider {
  identifier: string;
  name: string;
  authType: 'oauth' | 'apikey';
}

interface Metric {
  label: string;
  data: Array<{ total: string; date: string }>;
  percentageChange: number;
  average?: boolean;
}

interface Table {
  label: string;
  columns: string[];
  rows: Array<Array<string | number>>;
}

const useWebsite = (id: string) => {
  const load = useJson();
  return useSWR<{
    id: string;
    name: string;
    domain: string;
    sources: WebsiteSource[];
  }>(`/websites/${id}`, load, swrOptions);
};

const useWebsiteProviders = () => {
  const load = useJson();
  return useSWR<Provider[]>('/websites/providers', load, swrOptions);
};

const useSourceProperties = (sourceId: string) => {
  const load = useJson();
  return useSWR<Array<{ id: string; name: string }>>(
    `/websites/sources/${sourceId}/properties`,
    load,
    swrOptions
  );
};

const useSourceMetrics = (sourceId: string, days: number) => {
  const load = useJson();
  return useSWR<Metric[]>(
    `/websites/sources/${sourceId}/metrics?date=${days}`,
    load,
    swrOptions
  );
};

const useSourceTables = (sourceId: string, days: number) => {
  const load = useJson();
  return useSWR<Table[]>(
    `/websites/sources/${sourceId}/tables?date=${days}`,
    load,
    swrOptions
  );
};

const ApiKeyModal: FC<{
  websiteId: string;
  provider: Provider;
  update: () => void;
}> = ({ websiteId, provider, update }) => {
  const fetch = useFetch();
  const modal = useModals();
  const toaster = useToaster();
  const t = useT();
  const [loading, setLoading] = useState(false);
  const methods = useForm({ mode: 'onChange' });

  const submit = useCallback(async (data: FieldValues) => {
    setLoading(true);
    const add = await fetch(`/websites/connect/${provider.identifier}`, {
      method: 'POST',
      body: JSON.stringify({ websiteId, apiKey: data.api }),
    });
    setLoading(false);

    if (!add.ok) {
      const { message } = await add.json();
      methods.setError('api', { message });
      return;
    }

    toaster.show(t('source_connected', 'Source connected'), 'success');
    modal.closeAll();
    update();
  }, [fetch, provider, websiteId, update]);

  return (
    <FormProvider {...methods}>
      <form
        className="gap-[8px] flex flex-col"
        onSubmit={methods.handleSubmit(submit)}
      >
        <Input label="API Key" name="api" />
        <div>
          <Button loading={loading} type="submit">
            {t('connect', 'Connect')}
          </Button>
        </div>
      </form>
    </FormProvider>
  );
};

const MetricCard: FC<{ metric: Metric; index: number }> = ({
  metric,
  index,
}) => {
  const item = useMemo(
    () => ({
      ...metric,
      data: metric.data.map((p) => ({ date: p.date, total: Number(p.total) })),
    }),
    [metric]
  );

  const total = useMemo(() => {
    const sum = item.data.reduce((acc, p) => acc + p.total, 0);
    if (metric.average) {
      return item.data.length ? (sum / item.data.length).toFixed(2) : '0';
    }
    return new Intl.NumberFormat().format(Math.round(sum));
  }, [item]);

  return <AnalyticsCard item={item} total={total} index={index} />;
};

const SourceTable: FC<{ table: Table }> = ({ table }) => {
  return (
    <div className="flex flex-col bg-newTableHeader border border-newTableBorder rounded-[12px] overflow-hidden">
      <div className="px-[16px] py-[12px] text-[15px] font-medium">
        {table.label}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-textItemBlur text-start">
              {table.columns.map((column, index) => (
                <th
                  key={column}
                  className={clsx(
                    'px-[16px] py-[8px] font-normal',
                    index === 0 ? 'text-start' : 'text-end'
                  )}
                >
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, rowIndex) => (
              <tr key={rowIndex} className="border-t border-newTableBorder">
                {row.map((cell, index) => (
                  <td
                    key={index}
                    className={clsx(
                      'px-[16px] py-[8px]',
                      index === 0
                        ? 'text-start max-w-[320px] truncate'
                        : 'text-end'
                    )}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const SourceData: FC<{ sourceId: string; days: number }> = ({
  sourceId,
  days,
}) => {
  const metrics = useSourceMetrics(sourceId, days);
  const tables = useSourceTables(sourceId, days);

  if (metrics.isLoading) {
    return (
      <div className="flex justify-center py-[24px]">
        <LoadingComponent />
      </div>
    );
  }

  if (metrics.error) {
    return (
      <div className="text-[14px] text-red-400">{metrics.error.message}</div>
    );
  }

  return (
    <div className="flex flex-col gap-[16px]">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-[16px]">
        {metrics.data?.map((metric, index) => (
          <MetricCard key={metric.label} metric={metric} index={index} />
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-[16px]">
        {tables.data?.map((table) => (
          <SourceTable key={table.label} table={table} />
        ))}
      </div>
    </div>
  );
};

const SelectProperty: FC<{ sourceId: string; update: () => void }> = ({
  sourceId,
  update,
}) => {
  const fetch = useFetch();
  const t = useT();
  const toaster = useToaster();
  const [selected, setSelected] = useState('');
  const { data, isLoading, error } = useSourceProperties(sourceId);

  const save = useCallback(async () => {
    const response = await fetch(`/websites/sources/${sourceId}/property`, {
      method: 'PUT',
      body: JSON.stringify({ externalId: selected }),
    });

    if (!response.ok) {
      const { message } = await response.json();
      toaster.show(message, 'warning');
      return;
    }

    update();
  }, [fetch, sourceId, selected, update]);

  if (isLoading) {
    return <LoadingComponent />;
  }

  if (error) {
    return <div className="text-[14px] text-red-400">{error.message}</div>;
  }

  if (!data?.length) {
    return (
      <div className="text-[14px] text-textItemBlur">
        {t(
          'no_properties_found',
          'No verified properties were found on this account.'
        )}
      </div>
    );
  }

  return (
    <div className="flex items-end gap-[12px]">
      <div className="flex-1">
        <Select
          label={t('select_property', 'Select property')}
          name="property"
          disableForm={true}
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
        >
          <option value="">{t('select', 'Select')}</option>
          {data.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      </div>
      <Button disabled={!selected} onClick={save}>
        {t('save', 'Save')}
      </Button>
    </div>
  );
};

export const WebsiteDashboardComponent: FC<{ id: string }> = ({ id }) => {
  const t = useT();
  const fetch = useFetch();
  const modals = useModals();
  const toaster = useToaster();
  const [days, setDays] = useState(30);
  const [tab, setTab] = useState<'analytics' | 'insights' | 'content'>(
    'analytics'
  );
  const tabs = [
    { key: 'analytics' as const, label: t('analytics', 'Analytics') },
    { key: 'insights' as const, label: t('insights', 'Insights') },
    { key: 'content' as const, label: t('content', 'Content') },
  ];
  const { data: website, isLoading, mutate } = useWebsite(id);
  const { data: providers } = useWebsiteProviders();

  const connect = useCallback(
    (provider: Provider) => async () => {
      if (provider.authType === 'apikey') {
        modals.openModal({
          title: `${t('connect', 'Connect')} ${provider.name}`,
          withCloseButton: false,
          children: (
            <ApiKeyModal websiteId={id} provider={provider} update={mutate} />
          ),
        });
        return;
      }

      const response = await fetch(
        `/websites/${id}/connect/${provider.identifier}`
      );
      const { url, message } = await response.json();
      if (!response.ok || !url) {
        toaster.show(
          message ||
            t('could_not_start_connection', 'Could not start the connection'),
          'warning'
        );
        return;
      }

      window.location.href = url;
    },
    [fetch, modals, toaster, t, id, mutate]
  );

  const disconnect = useCallback(
    (sourceId: string) => async () => {
      if (
        !(await deleteDialog(
          t(
            'are_you_sure_you_want_to_disconnect_this_source',
            'Are you sure you want to disconnect this source?'
          )
        ))
      ) {
        return;
      }

      await fetch(`/websites/sources/${sourceId}`, { method: 'DELETE' });
      mutate();
    },
    [fetch, t, mutate]
  );

  const providerName = useCallback(
    (identifier: string) =>
      providers?.find((p) => p.identifier === identifier)?.name || identifier,
    [providers]
  );

  if (isLoading || !website) {
    return (
      <div className="bg-newBgColorInner flex flex-1 items-center justify-center">
        <LoadingComponent />
      </div>
    );
  }

  return (
    <div className="bg-newBgColorInner p-[20px] flex flex-1 flex-col gap-[20px]">
      <div className="flex items-center gap-[12px]">
        <div className="flex-1 flex flex-col">
          <Link href="/websites" className="text-[13px] text-textItemBlur">
            {t('websites', 'Websites')}
          </Link>
          <h2 className="text-[24px] font-[600]">{website.name}</h2>
          <div className="text-[14px] text-textItemBlur">{website.domain}</div>
        </div>
        <div className="w-[160px]">
          <Select
            label=""
            name="days"
            disableForm={true}
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
          >
            <option value={7}>{t('7_days', '7 Days')}</option>
            <option value={30}>{t('30_days', '30 Days')}</option>
            <option value={90}>{t('90_days', '90 Days')}</option>
          </Select>
        </div>
      </div>

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

      {tab === 'analytics' && (
        <>
          <div className="flex flex-wrap gap-[8px]">
            {providers?.map((provider) => (
              <Button
                key={provider.identifier}
                className="!bg-btnSimple !text-btnText"
                onClick={connect(provider)}
              >
                {t('connect', 'Connect')} {provider.name}
              </Button>
            ))}
          </div>

          {website.sources.map((source) => (
            <div
              key={source.id}
              className="flex flex-col gap-[16px] p-[16px] border border-newTableBorder rounded-[12px]"
            >
              <div className="flex items-center gap-[12px]">
                <div className="flex-1 flex flex-col">
                  <div className="text-[18px] font-[600]">
                    {providerName(source.providerIdentifier)}
                  </div>
                  <div className="text-[13px] text-textItemBlur">
                    {source.name}
                    {source.externalId ? ` · ${source.externalId}` : ''}
                  </div>
                </div>
                <div
                  onClick={disconnect(source.id)}
                  className="text-[13px] text-red-400 cursor-pointer hover:underline"
                >
                  {t('disconnect', 'Disconnect')}
                </div>
              </div>
              {source.refreshNeeded ? (
                <div className="text-[14px] text-red-400">
                  {t(
                    'source_needs_reconnect',
                    'This source needs to be reconnected.'
                  )}
                </div>
              ) : source.externalId ? (
                <SourceData sourceId={source.id} days={days} />
              ) : (
                <SelectProperty sourceId={source.id} update={mutate} />
              )}
            </div>
          ))}
        </>
      )}

      {tab === 'insights' && (
        <>
          <ContentSourceBar websiteId={website.id} />
          <WebsiteInsightsComponent websiteId={website.id} days={days} />
        </>
      )}

      {tab === 'content' && (
        <>
          <ContentSourceBar websiteId={website.id} />
          <WebsiteContentHistoryComponent websiteId={website.id} />
        </>
      )}
    </div>
  );
};
