import { Module, type OnApplicationBootstrap } from '@nestjs/common';
import { SharedModule } from '../shared/shared.module';
import { EntityAccessRegistry } from '../shared/entity-access.registry';
import { ContactCompanyController } from './contact-company.controller';
import { ContactCompanyRepository } from './contact-company.repository';
import { ContactCompanyService } from './contact-company.service';
import { ContactGraphRepository } from './contact-graph.repository';
import { ContactGraphService } from './contact-graph.service';
import { ContactVocabularyController } from './contact-vocabulary.controller';
import { ContactVocabularyRepository } from './contact-vocabulary.repository';
import { ContactVocabularyService } from './contact-vocabulary.service';
import { ContactController } from './contact.controller';
import { ContactRepository } from './contact.repository';
import { ContactService } from './contact.service';

/**
 * Human relationship management: contacts, their channels, companies, the
 * curated vocabularies, the relationship graph and the interaction timeline.
 *
 * Registers its entity access resolvers on bootstrap. Until it does, comments
 * and attachments on a contact are admin-only — `EntityAccessRegistry` denies
 * what nothing has vouched for.
 */
@Module({
  imports: [SharedModule],
  controllers: [
    ContactController,
    ContactCompanyController,
    ContactVocabularyController,
  ],
  providers: [
    ContactRepository,
    ContactCompanyRepository,
    ContactVocabularyRepository,
    ContactGraphRepository,
    ContactService,
    ContactCompanyService,
    ContactVocabularyService,
    ContactGraphService,
  ],
  exports: [ContactService, ContactCompanyService, ContactGraphService],
})
export class ContactsModule implements OnApplicationBootstrap {
  constructor(
    private readonly access: EntityAccessRegistry,
    private readonly contacts: ContactService,
    private readonly companies: ContactCompanyService,
  ) {}

  onApplicationBootstrap(): void {
    this.access.register('contact', (id, principal) =>
      this.contacts.canRead(id, principal),
    );
    // A company is shared reference data: any authenticated caller may read it,
    // which the registry has already established before delegating here.
    this.access.register('contact_company', () => this.companies.canRead());
  }
}
