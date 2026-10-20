import { Global, Module } from '@nestjs/common';
import { HeygenProvider } from '@gitroom/nestjs-libraries/3rdparties/heygen/heygen.provider';
import { ReelFarmProvider } from '@gitroom/nestjs-libraries/3rdparties/reelfarm/reelfarm.provider';
import { HubspotProvider } from '@gitroom/nestjs-libraries/3rdparties/hubspot/hubspot.provider';
import { HubspotCrmProvider } from '@gitroom/nestjs-libraries/3rdparties/hubspot-crm/hubspot.crm.provider';
import { ThirdPartyManager } from '@gitroom/nestjs-libraries/3rdparties/thirdparty.manager';

@Global()
@Module({
  providers: [
    HeygenProvider,
    ReelFarmProvider,
    HubspotProvider,
    HubspotCrmProvider,
    ThirdPartyManager,
  ],
  get exports() {
    return this.providers;
  },
})
export class ThirdPartyModule {}
