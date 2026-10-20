import {
  ThirdParty,
  ThirdPartyAbstract,
} from '@gitroom/nestjs-libraries/3rdparties/thirdparty.interface';

export interface CrmLead {
  name: string;
  handle: string;
  profileUrl?: string;
  platform: string;
  content: string;
  url?: string;
  reason?: string;
}

// The API key is a HubSpot private app token with the
// crm.objects.contacts.write scope
@ThirdParty({
  identifier: 'hubspot-crm',
  title: 'HubSpot CRM',
  description:
    'Send people who show buying intent in comments and mentions to HubSpot as contacts.',
  fields: [],
})
export class HubspotCrmProvider extends ThirdPartyAbstract<CrmLead> {
  private async request(apiKey: string, path: string, init?: RequestInit) {
    const response = await fetch(`https://api.hubapi.com${path}`, {
      ...init,
      signal: AbortSignal.timeout(30000),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`HubSpot ${response.status}: ${await response.text()}`);
    }

    return response.json();
  }

  async checkConnection(
    apiKey: string
  ): Promise<false | { name: string; username: string; id: string }> {
    try {
      const { portalId } = await this.request(
        apiKey,
        '/account-info/v3/details'
      );
      return {
        name: `HubSpot ${portalId}`,
        username: String(portalId),
        id: `hubspot-crm-${portalId}`,
      };
    } catch (err) {
      return false;
    }
  }

  async sendData(apiKey: string, data: CrmLead) {
    return (await this.createLead(apiKey, data)).id;
  }

  async createLead(apiKey: string, data: CrmLead) {
    const [firstname, ...rest] = (data.name || data.handle).split(' ');
    const { id } = await this.request(apiKey, '/crm/v3/objects/contacts', {
      method: 'POST',
      body: JSON.stringify({
        properties: {
          firstname,
          lastname: rest.join(' '),
          website: data.profileUrl || '',
          hs_lead_status: 'NEW',
        },
      }),
    });

    // 202 is HubSpot's note to contact association type
    await this.request(apiKey, '/crm/v3/objects/notes', {
      method: 'POST',
      body: JSON.stringify({
        properties: {
          hs_timestamp: new Date().toISOString(),
          hs_note_body: [
            `Lead from ${data.platform} (@${data.handle})`,
            data.reason ? `Why: ${data.reason}` : '',
            `Message: ${data.content}`,
            data.url ? `Link: ${data.url}` : '',
          ]
            .filter(Boolean)
            .join('<br>'),
        },
        associations: [
          {
            to: { id },
            types: [
              { associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 202 },
            ],
          },
        ],
      }),
    });

    return { id };
  }
}
