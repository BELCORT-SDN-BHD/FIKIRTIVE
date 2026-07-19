import ContactProfilePage from "@/components/crm/contact-profile-page";
import { getContact } from "@/lib/crm-view-data";

export const dynamic = "force-dynamic";
export const metadata = { title: "Contact profile · Fikirtive" };

export default async function CrmContactProfileRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ContactProfilePage initialState={await getContact(id)} />;
}
