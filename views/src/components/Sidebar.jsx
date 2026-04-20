import { NavLink } from 'react-router-dom';
import { useSelector } from 'react-redux';

const navItems = [
  { to: '/', label: 'Dashboard', icon: '📊', roles: ['super_admin', 'admin', 'member'] },
  { to: '/cycles', label: 'Cycles', icon: '🔄', roles: ['super_admin', 'admin'] },
  { to: '/members', label: 'Members', icon: '👥', roles: ['super_admin', 'admin', 'member'] },
  { to: '/savings', label: 'Savings', icon: '💰', roles: ['super_admin', 'admin', 'member'] },
  { to: '/loans', label: 'Loans', icon: '🏦', roles: ['super_admin', 'admin', 'member'] },
  { to: '/declarations', label: 'Declarations', icon: '📝', roles: ['super_admin', 'admin', 'member'] },
  { to: '/approvals', label: 'Approvals', icon: '✅', roles: ['super_admin', 'admin'] },
  { to: '/reports', label: 'Reports', icon: '📈', roles: ['super_admin', 'admin'] },
  { to: '/user-management', label: 'Users', icon: '🛡️', roles: ['super_admin'] },
];

export default function Sidebar({ onNavigate }) {
  const { user } = useSelector((state) => state.auth);
  const currentMonth = useSelector((state) => state.month.currentMonth);
  const userRole = user?.role || 'member';

  const visibleItems = navItems.filter((item) => item.roles.includes(userRole));

  return (
    <aside className="w-64 h-full bg-gray-900 text-white flex flex-col shadow-xl">
      <div className="p-6 border-b border-gray-800">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div>
            <h2 className="font-bold">Village Bank</h2>
            <p className="text-xs text-gray-400">Financial System</p>
          </div>
        </div>
      </div>

      <div className="mx-4 mt-4 mb-2 p-3 bg-blue-900/50 border border-blue-700 rounded-lg">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-gray-400">Current Cycle</p>
            <p className="font-semibold text-blue-300">Month {currentMonth}</p>
          </div>
          <div className="w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center">
            <span className="text-sm font-bold">{currentMonth}</span>
          </div>
        </div>
      </div>

      <nav className="flex-1 px-4 py-2 space-y-1 overflow-y-auto">
        {visibleItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            onClick={onNavigate}
            className={({ isActive }) =>
              `flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-300 hover:bg-gray-800 hover:text-white'
              }`
            }
          >
            <span className="text-lg">{item.icon}</span>
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="p-4 border-t border-gray-800">
        <p className="text-xs text-gray-500">Version 1.0.0</p>
      </div>
    </aside>
  );
}
