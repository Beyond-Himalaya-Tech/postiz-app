'use client';

import { FC, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { LoadingComponent } from '@gitroom/frontend/components/layout/loading';

export const WebsiteOAuthComponent: FC<{
  provider: string;
  searchParams: { code?: string; state?: string; error?: string };
}> = ({ provider, searchParams }) => {
  const fetch = useFetch();
  const router = useRouter();
  const t = useT();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    // The code can only be exchanged once, guard against a double mount
    if (started.current) {
      return;
    }
    started.current = true;

    (async () => {
      if (searchParams.error || !searchParams.code) {
        setError(searchParams.error || 'Missing code');
        return;
      }

      const response = await fetch(`/websites/connect/${provider}`, {
        method: 'POST',
        body: JSON.stringify({
          code: searchParams.code,
          state: searchParams.state,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        setError(data.message);
        return;
      }

      router.push(`/websites/${data.websiteId}`);
    })();
  }, []);

  return (
    <div className="bg-newBgColorInner flex flex-1 flex-col gap-[12px] items-center justify-center text-center">
      {error ? (
        <>
          <div className="text-[24px] font-[600]">
            {t('could_not_connect_source', 'Could not connect source')}
          </div>
          <div className="text-[14px] text-red-400">{error}</div>
        </>
      ) : (
        <>
          <div className="text-[24px] font-[600]">
            {t('connecting_source', 'Connecting source')}
          </div>
          <LoadingComponent />
        </>
      )}
    </div>
  );
};
