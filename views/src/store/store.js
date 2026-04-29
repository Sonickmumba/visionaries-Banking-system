import { configureStore } from '@reduxjs/toolkit';
import {
  authReducer,
  cycleReducer,
  groupReducer,
  loanReducer,
  memberReducer,
  monthlyReportReducer,
  monthReducer,
  notificationReducer,
  savingsReducer,
  userManagementReducer,
} from './slices/index.js';
import { api } from './api.js';

export const store = configureStore({
  reducer: {
    auth: authReducer,
    groups: groupReducer,
    cycles: cycleReducer,
    members: memberReducer,
    savings: savingsReducer,
    loans: loanReducer,
    notifications: notificationReducer,
    monthlyReport: monthlyReportReducer,
    month: monthReducer,
    userManagement: userManagementReducer,
    [api.reducerPath]: api.reducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: false,
    }).concat(api.middleware),
});

export default store;
