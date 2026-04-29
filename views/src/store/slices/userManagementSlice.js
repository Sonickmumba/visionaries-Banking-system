import { createAsyncThunk, createSlice } from '@reduxjs/toolkit';
import axios from 'axios';

axios.defaults.withCredentials = true;

export const fetchUsers = createAsyncThunk('userManagement/fetchUsers', async (_, { rejectWithValue }) => {
  try {
    const { data: res } = await axios.get('/api/auth/users');
    return res.data.users;
  } catch (error) {
    return rejectWithValue(error.response?.data?.message || 'Failed to load users');
  }
});

export const createAdminUser = createAsyncThunk(
  'userManagement/createAdminUser',
  async ({ full_name, email, phone, password }, { rejectWithValue }) => {
    try {
      const { data: res } = await axios.post('/api/auth/admin-users', {
        full_name,
        email,
        phone,
        password,
      });
      return res.data.user;
    } catch (error) {
      return rejectWithValue(error.response?.data?.message || 'Failed to create admin user');
    }
  }
);

export const updateManagedUserRole = createAsyncThunk(
  'userManagement/updateManagedUserRole',
  async ({ userId, role }, { rejectWithValue }) => {
    try {
      const { data: res } = await axios.patch(`/api/auth/users/${userId}/role`, { role });
      return res.data.user;
    } catch (error) {
      return rejectWithValue(error.response?.data?.message || 'Failed to update user role');
    }
  }
);

const initialState = {
  users: [],
  loading: false,
  creating: false,
  updatingUserId: null,
  error: null,
  successMessage: null,
};

const userManagementSlice = createSlice({
  name: 'userManagement',
  initialState,
  reducers: {
    clearUserManagementFeedback(state) {
      state.error = null;
      state.successMessage = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchUsers.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchUsers.fulfilled, (state, action) => {
        state.loading = false;
        state.users = action.payload;
      })
      .addCase(fetchUsers.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload;
      })
      .addCase(createAdminUser.pending, (state) => {
        state.creating = true;
        state.error = null;
        state.successMessage = null;
      })
      .addCase(createAdminUser.fulfilled, (state, action) => {
        state.creating = false;
        state.users = [action.payload, ...state.users];
        state.successMessage = 'Admin user created successfully.';
      })
      .addCase(createAdminUser.rejected, (state, action) => {
        state.creating = false;
        state.error = action.payload;
      })
      .addCase(updateManagedUserRole.pending, (state, action) => {
        state.updatingUserId = action.meta.arg.userId;
        state.error = null;
        state.successMessage = null;
      })
      .addCase(updateManagedUserRole.fulfilled, (state, action) => {
        state.updatingUserId = null;
        state.users = state.users.map((user) => (user.id === action.payload.id ? action.payload : user));
        state.successMessage = 'User role updated successfully.';
      })
      .addCase(updateManagedUserRole.rejected, (state, action) => {
        state.updatingUserId = null;
        state.error = action.payload;
      });
  },
});

export const { clearUserManagementFeedback } = userManagementSlice.actions;
export default userManagementSlice.reducer;