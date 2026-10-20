'use client';

import { FC, useCallback, useState } from 'react';
import useSWR from 'swr';
import Link from 'next/link';
import { FieldValues, FormProvider, useForm } from 'react-hook-form';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { Input } from '@gitroom/react/form/input';
import { Button } from '@gitroom/react/form/button';
import { LoadingComponent } from '@gitroom/frontend/components/layout/loading';
import { deleteDialog } from '@gitroom/react/helpers/delete.dialog';

export interface WebsiteSource {
  id: string;
  websiteId: string;
  providerIdentifier: string;
  name: string;
  externalId: string | null;
  refreshNeeded: boolean;
}

interface Website {
  id: string;
  name: string;
  domain: string;
  sources: WebsiteSource[];
}

export const swrOptions = {
  revalidateOnFocus: false,
  revalidateOnReconnect: false,
  revalidateIfStale: false,
};

// SWR fetcher for the websites module, a failed request becomes an SWR error
// carrying the backend message, so each card can show why it failed
export const useJson = () => {
  const fetch = useFetch();
  return useCallback(
    async (url: string) => {
      const response = await fetch(url);
      const json = await response.json();
      if (!response.ok) {
        throw new Error(json.message);
      }
      return json;
    },
    [fetch]
  );
};

const useWebsites = () => {
  const load = useJson();
  return useSWR<Website[]>('/websites', load, swrOptions);
};

const AddWebsiteModal: FC<{ update: () => void }> = ({ update }) => {
  const fetch = useFetch();
  const modal = useModals();
  const toaster = useToaster();
  const t = useT();
  const [loading, setLoading] = useState(false);
  const methods = useForm({ mode: 'onChange' });

  const submit = useCallback(async (data: FieldValues) => {
    setLoading(true);
    const add = await fetch('/websites', {
      method: 'POST',
      body: JSON.stringify({
        name: data.name,
        domain: String(data.domain || '')
          .replace(/^https?:\/\//, '')
          .replace(/\/.*$/, ''),
      }),
    });

    setLoading(false);
    if (!add.ok) {
      methods.setError('domain', {
        message: t('invalid_domain', 'Please enter a valid domain'),
      });
      return;
    }

    toaster.show(t('website_added', 'Website added'), 'success');
    modal.closeAll();
    update();
  }, [fetch, t, update]);

  return (
    <FormProvider {...methods}>
      <form
        className="gap-[8px] flex flex-col"
        onSubmit={methods.handleSubmit(submit)}
      >
        <Input label={t('name', 'Name')} name="name" />
        <Input
          label={t('domain', 'Domain')}
          name="domain"
          placeholder="example.com"
        />
        <div>
          <Button loading={loading} type="submit">
            {t('add_website', 'Add Website')}
          </Button>
        </div>
      </form>
    </FormProvider>
  );
};

export const WebsitesComponent = () => {
  const t = useT();
  const fetch = useFetch();
  const modals = useModals();
  const { data, isLoading, mutate } = useWebsites();

  const addWebsite = useCallback(() => {
    modals.openModal({
      title: t('add_website', 'Add Website'),
      withCloseButton: false,
      children: <AddWebsiteModal update={mutate} />,
    });
  }, [modals, t, mutate]);

  const deleteWebsite = useCallback(
    (id: string) => async () => {
      if (
        !(await deleteDialog(
          t(
            'are_you_sure_you_want_to_delete_this_website',
            'Are you sure you want to delete this website?'
          )
        ))
      ) {
        return;
      }

      await fetch(`/websites/${id}`, { method: 'DELETE' });
      mutate();
    },
    [fetch, t, mutate]
  );

  if (isLoading) {
    return (
      <div className="bg-newBgColorInner flex flex-1 items-center justify-center">
        <LoadingComponent />
      </div>
    );
  }

  return (
    <div className="bg-newBgColorInner p-[20px] flex flex-1 flex-col gap-[20px]">
      <div className="flex items-center">
        <h2 className="flex-1 text-[24px] font-[600]">
          {t('websites', 'Websites')}
        </h2>
        <Button onClick={addWebsite}>{t('add_website', 'Add Website')}</Button>
      </div>

      {!data?.length && (
        <div className="flex flex-col items-center justify-center py-[48px] gap-[12px] bg-newTableHeader border border-newTableBorder rounded-[12px] text-center">
          <div className="text-[18px] font-[500]">
            {t('no_websites_yet', 'No websites yet')}
          </div>
          <div className="text-[14px] text-textItemBlur max-w-[420px]">
            {t(
              'websites_description',
              'Add a website and connect Google Analytics, Search Console, Bing and Yandex to see your traffic and search data in one place.'
            )}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-[16px]">
        {data?.map((website) => (
          <div
            key={website.id}
            className="flex flex-col gap-[12px] p-[16px] bg-newTableHeader border border-newTableBorder rounded-[12px] hover:border-btnPrimary transition-all"
          >
            <Link href={`/websites/${website.id}`} className="flex flex-col">
              <div className="text-[18px] font-[600]">{website.name}</div>
              <div className="text-[14px] text-textItemBlur">
                {website.domain}
              </div>
            </Link>
            <div className="flex items-center gap-[8px]">
              <div className="flex-1 text-[13px] text-textItemBlur">
                {t('connected_sources', 'Connected sources')}:{' '}
                {website.sources.length}
              </div>
              <div
                onClick={deleteWebsite(website.id)}
                className="text-[13px] text-red-400 cursor-pointer hover:underline"
              >
                {t('delete', 'Delete')}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
