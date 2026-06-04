import { BrowserRouter, Routes, Route } from "react-router-dom";
import Header from "./components/Header.jsx";
import OrgDashboardPage from "./pages/OrgDashboardPage.jsx";
import OrgGeneratorPage from "./pages/OrgGeneratorPage.jsx";
import OrgDetailPage from "./pages/OrgDetailPage.jsx";
import OrgSettingsPage from "./pages/OrgSettingsPage.jsx";
import ItemsManagerPage from "./pages/ItemsManagerPage.jsx";

export default function App() {
  return (
    <BrowserRouter>
      <div className="app">
        <Header />
        <Routes>
          <Route path="/" element={<OrgDashboardPage />} />
          <Route path="/orgs/new" element={<OrgGeneratorPage />} />
          <Route path="/orgs/:slug" element={<OrgDetailPage />} />
          <Route path="/orgs/:slug/settings" element={<OrgSettingsPage />} />
          <Route path="/orgs/:slug/settings/:section" element={<OrgSettingsPage />} />
          <Route path="/items" element={<ItemsManagerPage />} />
          <Route path="/items/:itemId" element={<ItemsManagerPage />} />
        </Routes>
      </div>
    </BrowserRouter>
  );
}
