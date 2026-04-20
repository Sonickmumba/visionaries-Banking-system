import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import axios from 'axios';

// All requests send the httpOnly cookie automatically
axios.defaults.withCredentials = true;

// ── Async thunks ─────────────────────────────────────────────────────────────

export const login = createAsyncThunk('auth/login', async ({ email, password }, { rejectWithValue }) => {
  try {
    const { data: res } = await axios.post('/api/auth/login', { email, password });
    return { user: res.data.user };
  } catch (err) {
    return rejectWithValue(err.response?.data?.message || 'Login failed');
  }
});

export const signup = createAsyncThunk('auth/signup', async ({ full_name, email, phone, password }, { rejectWithValue }) => {
  try {
    await axios.post('/api/auth/signup', { full_name, email, phone, password });
  } catch (err) {
    return rejectWithValue(
      err.response?.data?.message || err.response?.data?.error || 'Signup failed'
    );
  }
});

export const logout = createAsyncThunk('auth/logout', async () => {
  try {
    await axios.post('/api/auth/logout');
  } catch {
    // Swallow — server clears cookie; we clear local state regardless
  }
});

/** Called once on app start to rehydrate auth from the httpOnly cookie */
export const fetchCurrentUser = createAsyncThunk('auth/fetchCurrentUser', async (_, { rejectWithValue }) => {
  try {
    const { data: res } = await axios.get('/api/auth/me');
    return { user: res.data.data };
  } catch {
    return rejectWithValue(null);
  }
});

// ── Slice ────────────────────────────────────────────────────────────────────

const authSlice = createSlice({
  name: 'auth',
  initialState: {
    user: null,
    loading: false,
    initializing: true, // true until fetchCurrentUser resolves
    error: null,
  },
  reducers: {
    clearError(state) {
      state.error = null;
    },
  },
  extraReducers: (builder) => {
    builder
      // login
      .addCase(login.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(login.fulfilled, (state, { payload }) => {
        state.loading = false;
        state.user = payload.user;
      })
      .addCase(login.rejected, (state, { payload }) => {
        state.loading = false;
        state.error = payload;
      })
      // signup
      .addCase(signup.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(signup.fulfilled, (state) => {
        state.loading = false;
      })
      .addCase(signup.rejected, (state, { payload }) => {
        state.loading = false;
        state.error = payload;
      })
      // logout
      .addCase(logout.fulfilled, (state) => {
        state.user = null;
      })
      // fetchCurrentUser (rehydrate on refresh)
      .addCase(fetchCurrentUser.pending, (state) => {
        state.initializing = true;
      })
      .addCase(fetchCurrentUser.fulfilled, (state, { payload }) => {
        state.initializing = false;
        state.user = payload.user;
      })
      .addCase(fetchCurrentUser.rejected, (state) => {
        state.initializing = false;
        state.user = null;
      });
  },
});

export const { clearError } = authSlice.actions;
export default authSlice.reducer;
