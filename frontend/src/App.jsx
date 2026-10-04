import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  Header,
  HeaderContainer,
  HeaderName,
  HeaderNavigation,
  HeaderMenuItem,
  HeaderGlobalBar,
  HeaderGlobalAction,
  SkipToContent,
  SideNav,
  SideNavItems,
  SideNavLink,
  Content
} from '@carbon/react';
import {
  Dashboard,
  Terminal,
  WarningAlt,
  Security,
  NetworkEnterprise,
  Notification,
  UserAvatar
} from '@carbon/icons-react';
import DemoBanner from './components/DemoBanner';
import AppRoutes from './routes';
import './App.scss';

export default function App() {
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <HeaderContainer
      render={({ isSideNavExpanded, onClickSideNavExpand }) => (
        <>
          <Header aria-label="IBM watsonx.data Presto SIEM Console">
            <SkipToContent />
            <HeaderName prefix="IBM" onClick={() => navigate('/')} style={{ cursor: 'pointer' }}>
              watsonx.data & Presto ⟷ SIEM Integration
            </HeaderName>
            <HeaderNavigation aria-label="Main Navigation">
              <HeaderMenuItem
                isCurrentPage={location.pathname === '/'}
                onClick={() => navigate('/')}
              >
                SIEM Log Activity
              </HeaderMenuItem>
              <HeaderMenuItem
                isCurrentPage={location.pathname === '/query-studio'}
                onClick={() => navigate('/query-studio')}
              >
                Presto Query Studio
              </HeaderMenuItem>
              <HeaderMenuItem
                isCurrentPage={location.pathname === '/offenses'}
                onClick={() => navigate('/offenses')}
              >
                Threat Offenses
              </HeaderMenuItem>
              <HeaderMenuItem
                isCurrentPage={location.pathname === '/compliance'}
                onClick={() => navigate('/compliance')}
              >
                Governance & Compliance
              </HeaderMenuItem>
              <HeaderMenuItem
                isCurrentPage={location.pathname === '/architecture'}
                onClick={() => navigate('/architecture')}
              >
                Architecture & Local Setup Guide
              </HeaderMenuItem>
            </HeaderNavigation>
            <HeaderGlobalBar>
              <HeaderGlobalAction aria-label="Notifications" tooltipAlignment="end">
                <Notification size={20} />
              </HeaderGlobalAction>
              <HeaderGlobalAction aria-label="SOC Profile" tooltipAlignment="end">
                <UserAvatar size={20} />
              </HeaderGlobalAction>
            </HeaderGlobalBar>
          </Header>

          <SideNav
            aria-label="Side Navigation"
            expanded={isSideNavExpanded}
            isPersistent={false}
            onSideNavBlur={onClickSideNavExpand}
          >
            <SideNavItems>
              <SideNavLink
                renderIcon={Dashboard}
                isActive={location.pathname === '/'}
                onClick={() => navigate('/')}
              >
                SIEM Log Activity
              </SideNavLink>
              <SideNavLink
                renderIcon={Terminal}
                isActive={location.pathname === '/query-studio'}
                onClick={() => navigate('/query-studio')}
              >
                Presto Query Studio
              </SideNavLink>
              <SideNavLink
                renderIcon={WarningAlt}
                isActive={location.pathname === '/offenses'}
                onClick={() => navigate('/offenses')}
              >
                Threat Offenses
              </SideNavLink>
              <SideNavLink
                renderIcon={Security}
                isActive={location.pathname === '/compliance'}
                onClick={() => navigate('/compliance')}
              >
                Governance & Compliance
              </SideNavLink>
              <SideNavLink
                renderIcon={NetworkEnterprise}
                isActive={location.pathname === '/architecture'}
                onClick={() => navigate('/architecture')}
              >
                Architecture & Local Setup Guide
              </SideNavLink>
            </SideNavItems>
          </SideNav>

          <Content className="demo-app-content">
            <DemoBanner />
            <AppRoutes />
          </Content>
        </>
      )}
    />
  );
}
