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
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: false,
    }),
});

export default store;
