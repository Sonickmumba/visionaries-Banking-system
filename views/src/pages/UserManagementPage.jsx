import { useEffect, useMemo, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Crown, Lock, Mail, Phone, RefreshCw, Shield, UserPlus, Users } from 'lucide-react';
import {
  clearUserManagementFeedback,
  createAdminUser,
  fetchUsers,
  updateManagedUserRole,
} from '../store';

const roleOptions = [
  { value: 'member', label: 'Member' },
  { value: 'admin', label: 'Admin' },
  { value: 'super_admin', label: 'Super Admin' },
];

export function UserManagementPage() {
  const dispatch = useDispatch();
  const { user: currentUser } = useSelector((state) => state.auth);
  const { users, loading, creating, updatingUserId, error, successMessage } = useSelector(
    (state) => state.userManagement
  );
  const [formData, setFormData] = useState({
    full_name: '',
    email: '',
    phone: '',
    password: '',
  });
  const [localError, setLocalError] = useState('');

  useEffect(() => {
    dispatch(fetchUsers());

    return () => {
      dispatch(clearUserManagementFeedback());
    };
  }, [dispatch]);

  const counts = useMemo(
    () =>
      users.reduce(
        (acc, managedUser) => {
          acc.total += 1;
          if (managedUser.role === 'super_admin') acc.superAdmins += 1;
          if (managedUser.role === 'admin') acc.admins += 1;
          if (managedUser.role === 'member') acc.members += 1;
          return acc;
        },
        { total: 0, superAdmins: 0, admins: 0, members: 0 }
      ),
    [users]
  );

  const handleChange = (event) => {
    const { name, value } = event.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleCreateAdmin = async (event) => {
    event.preventDefault();
    setLocalError('');
    dispatch(clearUserManagementFeedback());

    if (formData.password.length < 8) {
      setLocalError('Password must be at least 8 characters long.');
      return;
    }

    try {
      await dispatch(
        createAdminUser({
          full_name: formData.full_name.trim(),
          email: formData.email.trim().toLowerCase(),
          phone: formData.phone.trim(),
          password: formData.password,
        })
      ).unwrap();

      setFormData({ full_name: '', email: '', phone: '', password: '' });
    } catch {
      // handled in state
    }
  };

  const handleRoleChange = async (userId, role) => {
    setLocalError('');
    dispatch(clearUserManagementFeedback());

    try {
      await dispatch(updateManagedUserRole({ userId, role })).unwrap();
    } catch {
      // handled in state
    }
  };

  return (
    <div className="min-h-full bg-slate-50 px-3 py-4 sm:px-4 sm:py-6 md:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-[linear-gradient(135deg,#0f172a_0%,#1d4ed8_50%,#0f766e_100%)] p-4 text-white shadow-xl sm:rounded-3xl sm:p-6 md:p-8">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-medium uppercase tracking-[0.2em] text-cyan-100">
                <Shield className="h-4 w-4" />
                Super Admin Controls
              </div>
              <h2 className="mt-3 text-2xl font-bold tracking-tight sm:mt-4 sm:text-3xl md:text-4xl">User Management</h2>
              <p className="mt-3 text-sm text-blue-100 md:text-base">
                Create admin accounts, promote trusted operators, and keep privileged access under direct super-admin control.
              </p>
            </div>

            <button
              type="button"
              onClick={() => dispatch(fetchUsers())}
              disabled={loading}
              className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              Refresh users
            </button>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StatCard icon={Users} label="Total users" value={counts.total} accent="bg-slate-900" />
          <StatCard icon={Crown} label="Super admins" value={counts.superAdmins} accent="bg-amber-500" />
          <StatCard icon={Shield} label="Admins" value={counts.admins} accent="bg-cyan-600" />
          <StatCard icon={UserPlus} label="Members" value={counts.members} accent="bg-emerald-600" />
        </section>

        {(localError || error || successMessage) && (
          <div
            className={`rounded-2xl border px-4 py-3 text-sm shadow-sm ${
              localError || error
                ? 'border-rose-200 bg-rose-50 text-rose-700'
                : 'border-emerald-200 bg-emerald-50 text-emerald-700'
            }`}
          >
            {localError || error || successMessage}
          </div>
        )}

        <section className="grid gap-6 xl:grid-cols-[420px,minmax(0,1fr)]">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:rounded-3xl sm:p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-xl font-semibold text-slate-900">Create Admin</h3>
                <p className="mt-1 text-sm text-slate-600">
                  Public signup remains member-only. Use this form to create operational admin accounts.
                </p>
              </div>
              <div className="rounded-2xl bg-slate-900 p-3 text-white">
                <UserPlus className="h-5 w-5" />
              </div>
            </div>

            <form className="mt-6 space-y-4" onSubmit={handleCreateAdmin}>
              <InputField label="Full name" name="full_name" value={formData.full_name} onChange={handleChange} placeholder="e.g. Patricia Banda" />
              <InputField label="Email" name="email" type="email" value={formData.email} onChange={handleChange} placeholder="admin@example.com" icon={Mail} />
              <InputField label="Phone" name="phone" value={formData.phone} onChange={handleChange} placeholder="+260..." icon={Phone} />
              <InputField label="Temporary password" name="password" type="password" value={formData.password} onChange={handleChange} placeholder="At least 8 characters" icon={Lock} />

              <button
                type="submit"
                disabled={creating}
                className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <UserPlus className="h-4 w-4" />
                {creating ? 'Creating admin...' : 'Create admin account'}
              </button>
            </form>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:rounded-3xl sm:p-6">
            <div>
              <h3 className="text-xl font-semibold text-slate-900">Access Directory</h3>
              <p className="mt-1 text-sm text-slate-600">
                Review all users and adjust roles without exposing privileged access to the public registration flow.
              </p>
            </div>

            <div className="mt-4 space-y-3 md:hidden">
              {loading ? (
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                  Loading users...
                </div>
              ) : users.length === 0 ? (
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                  No users found.
                </div>
              ) : (
                users.map((managedUser) => {
                  const isSelf = managedUser.id === currentUser?.id;
                  return (
                    <article key={managedUser.id} className="rounded-2xl border border-slate-200 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-semibold text-slate-900">{managedUser.full_name}</p>
                          <p className="mt-1 text-xs text-slate-500">ID #{managedUser.id}</p>
                        </div>
                        <span
                          className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${
                            managedUser.status === 'active'
                              ? 'bg-emerald-100 text-emerald-700'
                              : 'bg-slate-200 text-slate-700'
                          }`}
                        >
                          {managedUser.status}
                        </span>
                      </div>

                      <div className="mt-3 space-y-1 text-sm text-slate-600">
                        <p className="break-all">{managedUser.email}</p>
                        <p>{managedUser.phone || 'No phone'}</p>
                        <p className="text-xs text-slate-500">
                          Created: {managedUser.createdAt ? new Date(managedUser.createdAt).toLocaleDateString() : '-'}
                        </p>
                      </div>

                      <div className="mt-3">
                        <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                          Role
                        </label>
                        <select
                          value={managedUser.role}
                          disabled={isSelf || updatingUserId === managedUser.id}
                          onChange={(event) => handleRoleChange(managedUser.id, event.target.value)}
                          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/20 disabled:cursor-not-allowed disabled:bg-slate-100"
                        >
                          {roleOptions.map((roleOption) => (
                            <option key={roleOption.value} value={roleOption.value}>
                              {roleOption.label}
                            </option>
                          ))}
                        </select>
                        {isSelf && <p className="mt-2 text-xs text-amber-600">Your own role is locked.</p>}
                      </div>
                    </article>
                  );
                })
              )}
            </div>

            <div className="mt-6 hidden overflow-hidden rounded-2xl border border-slate-200 md:block">
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200 text-sm">
                  <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                    <tr>
                      <th className="px-4 py-3">User</th>
                      <th className="px-4 py-3">Contact</th>
                      <th className="px-4 py-3">Role</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">Created</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {loading ? (
                      <tr>
                        <td colSpan="5" className="px-4 py-10 text-center text-slate-500">
                          Loading users...
                        </td>
                      </tr>
                    ) : users.length === 0 ? (
                      <tr>
                        <td colSpan="5" className="px-4 py-10 text-center text-slate-500">
                          No users found.
                        </td>
                      </tr>
                    ) : (
                      users.map((managedUser) => {
                        const isSelf = managedUser.id === currentUser?.id;

                        return (
                          <tr key={managedUser.id} className="align-top">
                            <td className="px-4 py-4">
                              <div className="font-semibold text-slate-900">{managedUser.full_name}</div>
                              <div className="mt-1 text-xs text-slate-500">ID #{managedUser.id}</div>
                            </td>
                            <td className="px-4 py-4 text-slate-600">
                              <div>{managedUser.email}</div>
                              <div className="mt-1 text-xs text-slate-500">{managedUser.phone || 'No phone'}</div>
                            </td>
                            <td className="px-4 py-4">
                              <select
                                value={managedUser.role}
                                disabled={isSelf || updatingUserId === managedUser.id}
                                onChange={(event) => handleRoleChange(managedUser.id, event.target.value)}
                                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/20 disabled:cursor-not-allowed disabled:bg-slate-100"
                              >
                                {roleOptions.map((roleOption) => (
                                  <option key={roleOption.value} value={roleOption.value}>
                                    {roleOption.label}
                                  </option>
                                ))}
                              </select>
                              {isSelf && <p className="mt-2 text-xs text-amber-600">Your own role is locked.</p>}
                            </td>
                            <td className="px-4 py-4">
                              <span
                                className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${
                                  managedUser.status === 'active'
                                    ? 'bg-emerald-100 text-emerald-700'
                                    : 'bg-slate-200 text-slate-700'
                                }`}
                              >
                                {managedUser.status}
                              </span>
                            </td>
                            <td className="px-4 py-4 text-slate-500">
                              {managedUser.createdAt ? new Date(managedUser.createdAt).toLocaleDateString() : '-'}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, accent }) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm text-slate-500">{label}</p>
          <p className="mt-3 text-3xl font-bold text-slate-900">{value}</p>
        </div>
        <div className={`rounded-2xl p-3 text-white ${accent}`}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </div>
  );
}

function InputField({ label, icon: Icon, ...props }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-slate-700">{label}</span>
      <div className="relative">
        {Icon && <Icon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />}
        <input
          {...props}
          required={props.name !== 'phone'}
          className={`w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-cyan-500 focus:bg-white focus:ring-2 focus:ring-cyan-500/20 ${
            Icon ? 'pl-10' : ''
          }`}
        />
      </div>
    </label>
  );
}