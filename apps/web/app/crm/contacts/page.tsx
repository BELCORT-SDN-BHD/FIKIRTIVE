import ContactsPage from "@/components/crm/contacts-page";
import { listContacts } from "@/lib/crm-view-data";

export const dynamic = "force-dynamic";
export const metadata = { title: "Contacts · Fikirtive" };

export default async function CrmContactsRoute() {
  return <ContactsPage initialState={await listContacts()} />;
}
