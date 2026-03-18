import Sidebar from "@/components/Sidebar";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", height: "100vh", backgroundColor: "#09090b" }}>
      <Sidebar />
      <main
        style={{
          flex: 1,
          marginLeft: "260px",
          overflowY: "auto",
          minHeight: "100vh",
          backgroundColor: "#09090b",
        }}
      >
        {children}
      </main>
    </div>
  );
}
