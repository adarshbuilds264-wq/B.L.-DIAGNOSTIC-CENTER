import React, { useState, useEffect } from 'react';
import {
  Users,
  Search,
  ShieldCheck,
  Shield,
  RefreshCw,
  Phone,
  Eye,
  X,
  UserCheck,
  ClipboardList,
  Home,
  FlaskConical,
  MapPin,
  Calendar,
} from 'lucide-react';
import { AdminUserListItem, AdminPatientListItem } from '../../types/admin';
import { UserRole } from '../../types/auth';
import { BookingRecord } from '../../types/bookingSystem';
import {
  fetchAdminUsers,
  fetchAdminPatients,
  updateUserRole,
  toggleUserStatus,
} from '../../services/adminService';
import { getBookingsForUser } from '../../services/orderService';
import { useAuth } from '../../contexts/AuthContext';
import { Badge, Button, ConfirmDialog } from '../ui/DesignSystem';

export const AdminUsersManager: React.FC = () => {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<AdminUserListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [selectedUser, setSelectedUser] = useState<AdminUserListItem | null>(null);
  const [modalAction, setModalAction] = useState<'ROLE' | 'DETAIL' | null>(null);
  const [userToToggleStatus, setUserToToggleStatus] = useState<AdminUserListItem | null>(null);
  const [newRoleSelect, setNewRoleSelect] = useState<UserRole>('USER');

  // Drill-down data for selected user (User -> Patients -> Bookings -> Selected Tests -> Home Collection Details)
  const [detailLoading, setDetailLoading] = useState(false);
  const [userPatients, setUserPatients] = useState<AdminPatientListItem[]>([]);
  const [userBookings, setUserBookings] = useState<BookingRecord[]>([]);

  const loadUsers = async () => {
    setLoading(true);
    try {
      const data = await fetchAdminUsers();
      setUsers(data);
    } catch (err) {
      console.error('Failed to load users:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadUsers();
  }, []);

  const handleOpenUserDetail = async (u: AdminUserListItem) => {
    setSelectedUser(u);
    setModalAction('DETAIL');
    setDetailLoading(true);
    try {
      const [allPatients, bookings] = await Promise.all([
        fetchAdminPatients(),
        getBookingsForUser(u.uid),
      ]);
      setUserPatients(allPatients.filter((p) => p.user_id === u.uid));
      setUserBookings(bookings);
    } catch (err) {
      console.error('Failed to load user drill-down details:', err);
    } finally {
      setDetailLoading(false);
    }
  };

  const filteredUsers = users.filter((u) => {
    const q = search.toLowerCase().trim();
    const userIdStr = (u.userId || u.uid || '').toLowerCase();
    const mobileStr = (u.mobile_number || u.phone || '').toLowerCase();
    const matchesSearch =
      !q ||
      u.displayName.toLowerCase().includes(q) ||
      mobileStr.includes(q) ||
      userIdStr.includes(q) ||
      u.uid.toLowerCase().includes(q);

    const matchesRole = roleFilter === 'ALL' || u.role === roleFilter;
    const matchesStatus =
      statusFilter === 'ALL' ||
      (statusFilter === 'ACTIVE' && u.isActive) ||
      (statusFilter === 'INACTIVE' && !u.isActive);

    return matchesSearch && matchesRole && matchesStatus;
  });

  const handleRoleChangeConfirm = async () => {
    if (!selectedUser || !currentUser) return;
    setUpdatingId(selectedUser.uid);
    try {
      await updateUserRole(selectedUser.uid, newRoleSelect, {
        uid: currentUser.uid,
        email: currentUser.mobile_number || currentUser.phone,
        role: currentUser.role,
      });
      setUsers((prev) =>
        prev.map((u) => (u.uid === selectedUser.uid ? { ...u, role: newRoleSelect } : u))
      );
      setModalAction(null);
      setSelectedUser(null);
    } catch (err: any) {
      console.error('Error updating role:', err);
    } finally {
      setUpdatingId(null);
    }
  };

  const handleConfirmToggleStatus = async () => {
    if (!userToToggleStatus || !currentUser) return;
    const targetStatus = !userToToggleStatus.isActive;
    setUpdatingId(userToToggleStatus.uid);
    try {
      await toggleUserStatus(userToToggleStatus.uid, targetStatus, {
        uid: currentUser.uid,
        email: currentUser.mobile_number || currentUser.phone,
        role: currentUser.role,
      });
      setUsers((prev) =>
        prev.map((u) =>
          u.uid === userToToggleStatus.uid ? { ...u, isActive: targetStatus } : u
        )
      );
    } catch (err: any) {
      console.error('Error updating user status:', err);
    } finally {
      setUpdatingId(null);
      setUserToToggleStatus(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-2xs flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-lg font-bold text-[#0F294A] flex items-center gap-2">
            <Users className="w-5 h-5 text-emerald-600" />
            <span>Registered Customers & Users (/admin/users)</span>
          </h2>
          <p className="text-xs text-slate-600 mt-1">
            Search customers by Mobile Number, Name, or User ID. Inspect linked Patients, Bookings, Selected Tests, and Home Collection details.
          </p>
        </div>

        <Button variant="outline" size="sm" onClick={loadUsers} disabled={loading}>
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Refresh Users</span>
        </Button>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search by Mobile Number (+91...), Name, or User ID (USR-...)..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-xs rounded-lg border border-slate-300 focus:outline-hidden focus:ring-2 focus:ring-[#0F294A] bg-white"
          />
        </div>

        <div className="flex items-center gap-2">
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            className="px-3 py-2 text-xs rounded-lg border border-slate-300 bg-white text-slate-700 focus:outline-hidden"
          >
            <option value="ALL">All Roles</option>
            <option value="USER">USER</option>
            <option value="STAFF">STAFF</option>
            <option value="ADMIN">ADMIN</option>
          </select>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 text-xs rounded-lg border border-slate-300 bg-white text-slate-700 focus:outline-hidden"
          >
            <option value="ALL">All Statuses</option>
            <option value="ACTIVE">Active Only</option>
            <option value="INACTIVE">Deactivated Only</option>
          </select>
        </div>
      </div>

      {/* Users Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-600">
            <thead className="bg-slate-50 text-[11px] font-bold text-slate-500 uppercase tracking-wider border-b border-slate-200">
              <tr>
                <th className="px-4 py-3.5">User ID & Name</th>
                <th className="px-4 py-3.5">Mobile Number</th>
                <th className="px-4 py-3.5">Mobile Verified</th>
                <th className="px-4 py-3.5">Role</th>
                <th className="px-4 py-3.5">Status</th>
                <th className="px-4 py-3.5 text-center">Patients</th>
                <th className="px-4 py-3.5 text-center">Bookings</th>
                <th className="px-4 py-3.5">Registered</th>
                <th className="px-4 py-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-slate-400">
                    <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-[#0F294A]" />
                    Loading customer records...
                  </td>
                </tr>
              ) : filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-slate-400">
                    No matching users found.
                  </td>
                </tr>
              ) : (
                filteredUsers.map((u) => {
                  const isSuperAdmin =
                    u.phone === '+919649183422' || u.phone === '9649183422';
                  const formattedUserId =
                    u.userId || `USR-${u.uid.slice(0, 6).toUpperCase()}`;
                  return (
                    <tr key={u.uid} className="hover:bg-slate-50/70 transition-colors">
                      <td className="px-4 py-3.5">
                        <div className="font-mono font-bold text-[#0F294A] text-xs">
                          {formattedUserId}
                        </div>
                        <div className="font-semibold text-slate-900 mt-0.5">
                          {u.displayName}
                        </div>
                      </td>

                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-1.5 text-slate-900 font-bold text-xs tabular-nums">
                          <Phone className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                          <span>
                            {u.phone && u.phone !== 'N/A'
                              ? u.phone.startsWith('+91')
                                ? u.phone
                                : `+91${u.phone}`
                              : 'Not provided'}
                          </span>
                        </div>
                      </td>

                      <td className="px-4 py-3.5">
                        <Badge variant="green">TRUE</Badge>
                      </td>

                      <td className="px-4 py-3.5">
                        <span
                          className={`px-2.5 py-0.5 rounded-md font-bold text-[10px] inline-flex items-center gap-1 ${
                            u.role === 'ADMIN'
                              ? 'bg-[#0F294A] text-white'
                              : u.role === 'STAFF'
                              ? 'bg-blue-100 text-blue-800'
                              : 'bg-slate-100 text-slate-700'
                          }`}
                        >
                          {u.role === 'ADMIN' && <Shield className="w-3 h-3" />}
                          {u.role === 'STAFF' && <ShieldCheck className="w-3 h-3" />}
                          {u.role}
                        </span>
                      </td>

                      <td className="px-4 py-3.5">
                        <Badge variant={u.isActive ? 'green' : 'red'}>
                          {u.isActive ? 'ACTIVE' : 'DEACTIVATED'}
                        </Badge>
                      </td>

                      <td className="px-4 py-3.5 text-center font-bold text-slate-800 tabular-nums">
                        {u.patientsCount ?? 0}
                      </td>

                      <td className="px-4 py-3.5 text-center font-bold text-slate-800 tabular-nums">
                        {u.bookingsCount ?? 0}
                      </td>

                      <td className="px-4 py-3.5 text-slate-500 whitespace-nowrap tabular-nums">
                        {new Date(u.createdAt).toLocaleDateString()}
                      </td>

                      <td className="px-4 py-3.5 text-right space-x-1.5 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => handleOpenUserDetail(u)}
                          className="px-2.5 py-1.5 text-[11px] font-bold rounded-lg bg-emerald-50 text-emerald-800 border border-emerald-200 hover:bg-emerald-100 inline-flex items-center gap-1 cursor-pointer transition-colors"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          <span>Inspect</span>
                        </button>

                        <button
                          type="button"
                          disabled={isSuperAdmin || updatingId === u.uid}
                          onClick={() => {
                            setSelectedUser(u);
                            setNewRoleSelect(u.role);
                            setModalAction('ROLE');
                          }}
                          className="px-2.5 py-1.5 text-[11px] font-semibold rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 disabled:opacity-40 cursor-pointer transition-colors"
                        >
                          Role
                        </button>

                        <button
                          type="button"
                          disabled={isSuperAdmin || updatingId === u.uid}
                          onClick={() => setUserToToggleStatus(u)}
                          className={`px-2.5 py-1.5 text-[11px] font-semibold rounded-lg transition-colors cursor-pointer disabled:opacity-40 ${
                            u.isActive
                              ? 'bg-red-50 text-red-700 hover:bg-red-100'
                              : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                          }`}
                        >
                          {u.isActive ? 'Deactivate' : 'Activate'}
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* USER DRILL-DOWN MODAL: User -> Patients -> Bookings -> Selected Tests -> Home Collection Details */}
      {modalAction === 'DETAIL' && selectedUser && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-xl max-w-4xl w-full max-h-[90vh] flex flex-col border border-slate-200 shadow-xl overflow-hidden">
            {/* Modal Header */}
            <div className="px-6 py-4 bg-[#0F294A] text-white flex items-center justify-between">
              <div>
                <span className="text-[11px] font-mono uppercase tracking-wider text-emerald-300 block">
                  Customer Drill-Down Record · {selectedUser.userId || selectedUser.uid}
                </span>
                <h3 className="text-base font-bold">
                  {selectedUser.displayName} ({selectedUser.phone})
                </h3>
              </div>
              <button
                type="button"
                onClick={() => {
                  setModalAction(null);
                  setSelectedUser(null);
                }}
                className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto space-y-6 text-xs">
              {/* 1. User Summary */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-50 p-4 rounded-xl border border-slate-200">
                <div>
                  <span className="text-[11px] text-slate-500 block">User ID</span>
                  <span className="font-mono font-bold text-[#0F294A]">
                    {selectedUser.userId || selectedUser.uid}
                  </span>
                </div>
                <div>
                  <span className="text-[11px] text-slate-500 block">Mobile Number</span>
                  <span className="font-bold text-slate-900 tabular-nums">
                    {selectedUser.phone}
                  </span>
                </div>
                <div>
                  <span className="text-[11px] text-slate-500 block">Mobile Verified</span>
                  <Badge variant="green">TRUE (OTP Verified)</Badge>
                </div>
                <div>
                  <span className="text-[11px] text-slate-500 block">Last Login</span>
                  <span className="font-medium text-slate-800 tabular-nums">
                    {selectedUser.lastLogin
                      ? new Date(selectedUser.lastLogin).toLocaleString()
                      : new Date(selectedUser.createdAt).toLocaleString()}
                  </span>
                </div>
              </div>

              {detailLoading ? (
                <div className="py-10 text-center text-slate-500">
                  <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-[#0F294A]" />
                  Loading linked Patients, Bookings, Selected Tests, and Home Collection records...
                </div>
              ) : (
                <>
                  {/* 2. Linked Patients */}
                  <div className="space-y-3">
                    <h4 className="text-sm font-bold text-[#0F294A] flex items-center gap-2">
                      <UserCheck className="w-4 h-4 text-emerald-600" />
                      <span>Linked Patients ({userPatients.length})</span>
                    </h4>
                    {userPatients.length === 0 ? (
                      <div className="p-4 rounded-lg bg-slate-50 border border-slate-200 text-slate-500">
                        No family patient profiles created under this customer yet.
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {userPatients.map((p) => (
                          <div
                            key={p.patient_id}
                            className="p-3.5 rounded-xl border border-slate-200 bg-white flex items-center justify-between"
                          >
                            <div>
                              <span className="font-mono text-[10px] text-slate-400 block">
                                {p.patient_id}
                              </span>
                              <span className="font-bold text-slate-900">{p.full_name}</span>
                              <span className="text-slate-600 block mt-0.5">
                                {p.relation} · {p.gender} · {p.age} Yrs
                              </span>
                            </div>
                            {p.phone && (
                              <span className="font-mono text-slate-700 tabular-nums">
                                {p.phone}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* 3. Bookings, Selected Tests & Home Collection Details */}
                  <div className="space-y-3">
                    <h4 className="text-sm font-bold text-[#0F294A] flex items-center gap-2">
                      <ClipboardList className="w-4 h-4 text-emerald-600" />
                      <span>
                        Bookings, Selected Tests & Home Collection Details ({userBookings.length})
                      </span>
                    </h4>
                    {userBookings.length === 0 ? (
                      <div className="p-4 rounded-lg bg-slate-50 border border-slate-200 text-slate-500">
                        No diagnostic bookings submitted by this customer yet.
                      </div>
                    ) : (
                      <div className="space-y-4">
                        {userBookings.map((b) => (
                          <div
                            key={b.booking_id}
                            className="p-4 rounded-xl border border-slate-200 bg-white space-y-3"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2.5">
                              <div className="flex items-center gap-2.5">
                                <span className="font-mono font-bold text-sm text-[#0F294A]">
                                  {b.booking_id}
                                </span>
                                <Badge
                                  variant={
                                    b.collection_type === 'HOME_COLLECTION' ? 'green' : 'navy'
                                  }
                                >
                                  {b.collection_type}
                                </Badge>
                                <Badge variant="amber">{b.status}</Badge>
                              </div>
                              <div className="flex items-center gap-2 text-slate-600 tabular-nums">
                                <Calendar className="w-3.5 h-3.5 text-emerald-600" />
                                <span className="font-semibold">
                                  {b.booking_date} · {b.time_slot}
                                </span>
                              </div>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-slate-700">
                              <div>
                                <span className="text-[11px] text-slate-500 block">Patient</span>
                                <span className="font-bold text-slate-900">
                                  {b.patient_name_snapshot} ({b.patient_age_snapshot}Y /{' '}
                                  {b.patient_gender_snapshot})
                                </span>
                              </div>
                              <div>
                                <span className="text-[11px] text-slate-500 block">
                                  Contact Mobile
                                </span>
                                <span className="font-semibold tabular-nums">
                                  {b.patient_phone_snapshot || selectedUser.phone}
                                </span>
                              </div>
                              <div>
                                <span className="text-[11px] text-slate-500 block">
                                  Estimated Total
                                </span>
                                <span className="font-extrabold text-[#0F294A] tabular-nums">
                                  ₹{b.total_amount}
                                </span>
                              </div>
                            </div>

                            {/* Selected Tests */}
                            <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 space-y-1.5">
                              <div className="flex items-center gap-1.5 font-bold text-[#0F294A]">
                                <FlaskConical className="w-3.5 h-3.5 text-emerald-600" />
                                <span>Selected Tests ({b.items.length})</span>
                              </div>
                              <div className="divide-y divide-slate-200/70">
                                {b.items.map((item) => (
                                  <div
                                    key={item.booking_item_id}
                                    className="py-1.5 flex items-center justify-between"
                                  >
                                    <div>
                                      <span className="font-semibold text-slate-900">
                                        {item.test_name_snapshot}
                                      </span>
                                      <span className="text-[11px] text-slate-500 ml-2 font-mono">
                                        ({item.test_id})
                                      </span>
                                    </div>
                                    <span className="font-bold text-slate-800 tabular-nums">
                                      ₹{item.price_snapshot}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </div>

                            {/* Home Collection Details */}
                            {b.collection_type === 'HOME_COLLECTION' && (
                              <div className="bg-emerald-50/70 p-3 rounded-lg border border-emerald-200 space-y-1">
                                <div className="flex items-center gap-1.5 font-bold text-emerald-950">
                                  <Home className="w-3.5 h-3.5 text-emerald-700" />
                                  <span>
                                    Home Collection Details (Collection ID: HC-{b.booking_id})
                                  </span>
                                </div>
                                <div className="flex items-start gap-1.5 text-emerald-900">
                                  <MapPin className="w-3.5 h-3.5 text-emerald-700 shrink-0 mt-0.5" />
                                  <span>
                                    Address: <strong>{b.home_address || 'Provided'}</strong>
                                    {b.area ? ` · Landmark/Area: ${b.area}` : ''}
                                    {b.pincode ? ` · Pincode: ${b.pincode}` : ''} · Jaipur
                                  </span>
                                </div>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Role Management Modal */}
      {modalAction === 'ROLE' && selectedUser && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-md w-full p-6 space-y-4 shadow-xl">
            <h3 className="text-base font-bold text-slate-900">
              Change User Role: {selectedUser.displayName}
            </h3>
            <p className="text-xs text-slate-600">
              Select the access level for <strong>{selectedUser.phone}</strong>.
            </p>

            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-700 block">Select Role</label>
              <div className="grid grid-cols-3 gap-2">
                {(['USER', 'STAFF', 'ADMIN'] as UserRole[]).map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setNewRoleSelect(r)}
                    className={`py-2 text-xs font-bold rounded-lg border cursor-pointer transition-all ${
                      newRoleSelect === r
                        ? 'bg-[#0F294A] text-white border-[#0F294A]'
                        : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" size="sm" onClick={() => setModalAction(null)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                isLoading={updatingId === selectedUser.uid}
                onClick={handleRoleChangeConfirm}
              >
                Save Role Change
              </Button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        isOpen={Boolean(userToToggleStatus)}
        title={
          userToToggleStatus?.isActive
            ? 'Deactivate Customer Account'
            : 'Activate Customer Account'
        }
        description={
          userToToggleStatus
            ? `${
                userToToggleStatus.isActive ? 'Deactivate' : 'Re-activate'
              } account for ${userToToggleStatus.displayName} (${userToToggleStatus.phone})?`
            : ''
        }
        confirmLabel={userToToggleStatus?.isActive ? 'Deactivate' : 'Activate'}
        variant={userToToggleStatus?.isActive ? 'danger' : 'primary'}
        onConfirm={handleConfirmToggleStatus}
        onCancel={() => setUserToToggleStatus(null)}
      />
    </div>
  );
};
