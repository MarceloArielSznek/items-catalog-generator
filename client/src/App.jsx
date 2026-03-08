import { BrowserRouter, Routes, Route } from "react-router-dom";
import Header from "./components/Header.jsx";
import BottomTabs from "./components/BottomTabs.jsx";
import SceneManagerPage from "./pages/SceneManagerPage.jsx";
import GeneratorPage from "./pages/GeneratorPage.jsx";
import LibraryPage from "./pages/LibraryPage.jsx";
import AlbumDetailPage from "./pages/AlbumDetailPage.jsx";
import ItemDetailPage from "./pages/ItemDetailPage.jsx";
import ServicePhotoPage from "./pages/ServicePhotoPage.jsx";

export default function App() {
  return (
    <BrowserRouter>
      <div className="app">
        <Header />
        <Routes>
          <Route path="/" element={<SceneManagerPage />} />
          <Route path="/generate/:sceneId" element={<GeneratorPage />} />
          <Route path="/service-photos" element={<ServicePhotoPage />} />
          <Route path="/library" element={<LibraryPage />} />
          <Route path="/library/:albumId" element={<AlbumDetailPage />} />
          <Route path="/library/:albumId/:itemId" element={<ItemDetailPage />} />
        </Routes>
        <BottomTabs />
      </div>
    </BrowserRouter>
  );
}
