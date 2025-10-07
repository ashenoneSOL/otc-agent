import "@/app/globals.css";

export default function Layout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return <div className="h-full flex flex-col overflow-y-auto">{children}</div>;
}
