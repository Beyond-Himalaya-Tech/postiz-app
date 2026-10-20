import { Injectable } from '@nestjs/common';
import { Activity, ActivityMethod } from 'nestjs-temporal-core';
import { EngagementService } from '@gitroom/nestjs-libraries/database/prisma/engagement/engagement.service';

@Injectable()
@Activity()
export class EngagementActivity {
  constructor(private _engagementService: EngagementService) {}

  @ActivityMethod()
  async collectEngagement(integrationId: string) {
    return this._engagementService.collect(integrationId);
  }
}
