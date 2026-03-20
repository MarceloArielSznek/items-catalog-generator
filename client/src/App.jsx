import { useCallback, useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, Navigate, Outlet, useNavigate } from "react-router-dom";
import Header from "./components/Header.jsx";
import BottomTabs from "./components/BottomTabs.jsx";
import SceneManagerPage from "./pages/SceneManagerPage.jsx";
import GeneratorPage from "./pages/GeneratorPage.jsx";
import LibraryPage from "./pages/LibraryPage.jsx";
import AlbumDetailPage from "./pages/AlbumDetailPage.jsx";
import ItemDetailPage from "./pages/ItemDetailPage.jsx";
import ServicePhotoPage from "./pages/ServicePhotoPage.jsx";
import ItemsManagerPage from "./pages/ItemsManagerPage.jsx";
import LoginPage from "./pages/LoginPage.jsx";
import "./pages/loginFormBuilderTheme.css";
import { ensureDevToken, isAuthenticated, login } from "./services/payloadAuth.js";
import { devAutoLoginEnabled, getDevAutoLoginCredentials } from "./lib/payloadEnv.js";

function ProtectedLayout() {
  if (import.meta.env.PROD && !isAuthenticated()) {
    return <Navigate to="/login" replace />;
  }
  return (
    <div className="app">
      <Header />
      <Outlet />
      <BottomTabs />
    </div>
  );
}

function LoginRoute() {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = useCallback(
    async ({ email, password }) => {
      setBusy(true);
      setError(null);
      const result = await login(email, password);
      if (!result.ok) {
        setError(result.error);
        setBusy(false);
        return;
      }
      navigate("/", { replace: true });
    },
    [navigate],
  );

  if (import.meta.env.PROD && isAuthenticated()) {
    return <Navigate to="/" replace />;
  }

  if (import.meta.env.DEV && devAutoLoginEnabled) {
    return <Navigate to="/" replace />;
  }

  const devCreds = import.meta.env.DEV ? getDevAutoLoginCredentials() : null;

  return (
    <LoginPage
      initialEmail={devCreds?.email ?? ""}
      initialPassword={devCreds?.password ?? ""}
      loading={busy}
      error={error}
      onSubmit={handleSubmit}
    />
  );
}

function AppBootstrap({ children }) {
  const [ready, setReady] = useState(import.meta.env.PROD);

  useEffect(() => {
    if (import.meta.env.DEV) {
      void ensureDevToken().finally(() => setReady(true));
    }
  }, []);

  if (!ready) {
    return (
      <div
        className="form-builder-login-scope"
        style={{ display: "grid", placeItems: "center", minHeight: "100svh" }}
      >
        <p style={{ color: "var(--text)", margin: 0 }}>Starting…</p>
      </div>
    );
  }

  return children;
}

export default function App() {
  return (
    <BrowserRouter>
      <AppBootstrap>
        <Routes>
          <Route path="/login" element={<LoginRoute />} />
          <Route path="/" element={<ProtectedLayout />}>
            <Route index element={<SceneManagerPage />} />
            <Route path="generate/:sceneId" element={<GeneratorPage />} />
            <Route path="service-photos" element={<ServicePhotoPage />} />
            <Route path="items" element={<ItemsManagerPage />} />
            <Route path="items/:itemId" element={<ItemsManagerPage />} />
            <Route path="library" element={<LibraryPage />} />
            <Route path="library/:albumId" element={<AlbumDetailPage />} />
            <Route path="library/:albumId/:itemId" element={<ItemDetailPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AppBootstrap>
    </BrowserRouter>
  );
}
