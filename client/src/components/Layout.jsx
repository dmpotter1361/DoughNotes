import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import DriveBanner from './DriveBanner.jsx';

export default function Layout({ children }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  async function handleLogout() {
    await logout();
    navigate('/');
  }

  return (
    <>
      <nav className="nav">
        <Link to="/" className="brand">Dough<span>Notes</span></Link>
        <Link to="/">Browse</Link>
        {user && <Link to="/my">My Recipes</Link>}
        {user && <Link to="/new">New Recipe</Link>}
        {user && <Link to="/planner">Planner</Link>}
        {user && <Link to="/shopping">Shopping</Link>}
        {user?.role === 'admin' && <Link to="/admin">Admin</Link>}
        <span className="spacer" />
        {user ? (
          <>
            <Link to="/account">{user.display_name}</Link>
            <a href="#" onClick={(e) => { e.preventDefault(); handleLogout(); }}>Log out</a>
          </>
        ) : (
          <>
            <Link to="/login">Log in</Link>
            <Link to="/register">Sign up</Link>
          </>
        )}
      </nav>
      <div className="container">
        {user && !user.drive_linked && <DriveBanner />}
        {children}
      </div>
    </>
  );
}
