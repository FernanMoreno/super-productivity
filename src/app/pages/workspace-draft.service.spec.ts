import { TestBed } from '@angular/core/testing';
import { TranslateService } from '@ngx-translate/core';
import { WorkspaceDraftService } from './workspace-draft.service';

describe('WorkspaceDraftService', () => {
  let service: WorkspaceDraftService;
  let confirm: jasmine.Spy;
  beforeEach(() => {
    // The project test harness installs a default confirm spy globally.
    confirm = jasmine.isSpy(window.confirm)
      ? (window.confirm as jasmine.Spy)
      : spyOn(window, 'confirm');
    confirm.calls.reset();
    confirm.and.returnValue(true);
    TestBed.configureTestingModule({
      providers: [
        { provide: TranslateService, useValue: { instant: () => 'Discard draft?' } },
      ],
    });
    service = TestBed.inject(WorkspaceDraftService);
  });
  it('keeps a dirty editor and its route when discard is declined', () => {
    const discard = jasmine.createSpy('discard');
    service.bind(discard);
    service.setDirty(true);
    confirm.and.returnValue(false);
    expect(service.canLeave()).toBe(false);
    expect(discard).not.toHaveBeenCalled();
    expect(service.canLeave()).toBe(false);
  });
  it('discards only on explicit confirmation and does not prompt a second time', () => {
    const discard = jasmine.createSpy('discard');
    service.bind(discard);
    service.setDirty(true);
    confirm.and.returnValue(true);
    expect(service.canLeave()).toBe(true);
    expect(discard).toHaveBeenCalledTimes(1);
    expect(service.canLeave()).toBe(true);
    expect(confirm).toHaveBeenCalledTimes(1);
  });
  it('preserves mounted drafts across safe sections and guards incompatible workflow context', () => {
    service.setState({
      dirty: true,
      workflowDirty: true,
      workflowContext: { section: 'workflow', projectId: 'alpha', taskId: 'task-a' },
    });
    confirm.and.returnValue(false);
    expect(service.canNavigate({ section: 'goals' })).toBe(true);
    expect(service.canNavigate({ section: 'week' })).toBe(true);
    expect(service.canNavigate({ section: 'workflow', projectId: 'alpha' })).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
    expect(service.canNavigate({ section: 'workflow', projectId: 'beta' })).toBe(false);
    expect(
      service.canNavigate({ section: 'workflow', projectId: 'alpha', taskId: 'task-b' }),
    ).toBe(false);
    expect(confirm).toHaveBeenCalledTimes(2);
  });
  it('keeps profile drafts mounted when switching workspace views', () => {
    service.setState({ dirty: true, workflowDirty: false });
    expect(service.canNavigate({ section: 'workflow', projectId: 'alpha' })).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
  });
  it('clears the prior iframe ownership when a workspace is destroyed', () => {
    service.setDirty(true);
    service.clear();

    expect(service.canLeave()).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
  });
});
