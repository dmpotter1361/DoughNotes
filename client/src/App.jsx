import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './auth.jsx';
import Layout from './components/Layout.jsx';
import PublicFeed from './pages/PublicFeed.jsx';
import Login from './pages/Login.jsx';
import Register from './pages/Register.jsx';
import MyRecipes from './pages/MyRecipes.jsx';
import RecipeEditor from './pages/RecipeEditor.jsx';
import RecipeView from './pages/RecipeView.jsx';
import Admin from './pages/Admin.jsx';
import Account from './pages/Account.jsx';
import Import from './pages/Import.jsx';
import CookMode from './pages/CookMode.jsx';

// Gate a route behind login (optionally admin-only).
function Protected({ children, adminOnly }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="container">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (adminOnly && user.role !== 'admin') return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<PublicFeed />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/recipes/:id" element={<RecipeView />} />
        <Route path="/recipes/:id/cook" element={<CookMode />} />

        <Route path="/my" element={<Protected><MyRecipes /></Protected>} />
        <Route path="/new" element={<Protected><RecipeEditor /></Protected>} />
        <Route path="/import" element={<Protected><Import /></Protected>} />
        <Route path="/recipes/:id/edit" element={<Protected><RecipeEditor /></Protected>} />
        <Route path="/admin" element={<Protected adminOnly><Admin /></Protected>} />
        <Route path="/account" element={<Protected><Account /></Protected>} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}
