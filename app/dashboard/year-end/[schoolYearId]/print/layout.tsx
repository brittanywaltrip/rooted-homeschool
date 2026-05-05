export default function PrintLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: "#f8f7f4", fontFamily: "sans-serif" }}>
        {children}
      </body>
    </html>
  );
}
