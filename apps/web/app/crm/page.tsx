import CustomersPreviewPage from "@/components/crm/customers-preview-page";

// #792 —— /crm 从前是 404(七扇门各有各的路由,根上什么都没有)。折叠之后它是**唯一**
// 的入口:导轨那一格指的就是这里。这一页不读数据库,说的每一句都是产品形状的事实,所以
// 是静态的 —— 没有 force-dynamic,也没有 loading/error 双胞胎要养。
export const metadata = { title: "Customers · Fikirtive" };

export default function CrmRoute() {
  return <CustomersPreviewPage />;
}
