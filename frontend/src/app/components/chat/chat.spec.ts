import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ChatMessage } from '../../shared/models/chat-message.model';
import { RoomSessionService } from '../../shared/services/room-session.service';
import { SYNC_SOCKET_FACTORY, SyncService } from '../../shared/services/sync.service';
import { FakeSyncSocket } from '../../shared/testing/fake-sync-socket';
import { ChatComponent } from './chat';

const message = (id: string, from: { id: string; name: string }, text: string): ChatMessage => ({
  id,
  from,
  text,
  at: Date.UTC(2026, 10, 25, 20, 15),
});
const ALEX = { id: 'p1', name: 'Alex' };
const SAM = { id: 'p2', name: 'Sam' };

describe('ChatComponent', () => {
  let fixture: ComponentFixture<ChatComponent>;
  let component: ChatComponent;
  let socket: FakeSyncSocket;

  const root = () => fixture.nativeElement as HTMLElement;
  const bubbles = () =>
    Array.from(root().querySelectorAll('.messages li:not(.empty)')).map((li) => ({
      who: li.querySelector('b')?.textContent,
      text: li.querySelector('.text')?.textContent,
      mine: li.classList.contains('mine'),
    }));
  const online = () =>
    socket.receive('room:state', { version: 0, playback: null, waitingFor: [], participants: [], serverTime: 0 });

  beforeEach(() => {
    socket = new FakeSyncSocket();
    TestBed.configureTestingModule({ providers: [{ provide: SYNC_SOCKET_FACTORY, useValue: () => socket }] });
    TestBed.inject(RoomSessionService).open({
      room: { code: 'K7P2QX', participants: [], expiresAt: '2026-11-26T10:00:00.000Z' },
      participant: ALEX,
      token: 'jeton',
    });
    TestBed.inject(SyncService).connect('jeton');
    fixture = TestBed.createComponent(ChatComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => localStorage.clear());

  it('sans message : invite à dire bonjour', () => {
    expect(root().querySelector('h2')?.textContent).toBe('Discussion');
    expect(root().textContent).toContain('Aucun message pour l’instant : dites bonjour !');
  });

  it('affiche l’historique reçu à la connexion, puis chaque nouveau message ; les siens à part', () => {
    online();
    socket.receive('chat:history', [message('m1', SAM, 'Salut !')]);
    socket.receive('chat:message', message('m2', ALEX, 'On lance le film ?'));
    fixture.detectChanges();

    expect(bubbles()).toEqual([
      { who: 'Sam', text: 'Salut !', mine: false },
      { who: 'Vous', text: 'On lance le film ?', mine: true },
    ]);
  });

  it('un message est affiché comme du texte, jamais comme du HTML', () => {
    socket.receive('chat:message', message('m1', SAM, '<img src=x onerror="alert(1)"><b>gras</b>'));
    fixture.detectChanges();

    const text = root().querySelector('.messages .text')!;
    expect(text.textContent).toBe('<img src=x onerror="alert(1)"><b>gras</b>');
    expect(text.querySelector('img, b')).toBeNull();
  });

  it('envoie le message au serveur et vide le champ quand il l’accepte', async () => {
    online();
    component.text.setValue('Bonsoir tout le monde');
    fixture.detectChanges();

    root().querySelector<HTMLButtonElement>('form button')!.click();
    expect(socket.sent('chat:send').map((args) => args[0])).toEqual(['Bonsoir tout le monde']);
    socket.acknowledge('chat:send', { ok: true });
    await Promise.resolve();
    fixture.detectChanges();

    expect(component.text.value).toBe('');
    expect(root().querySelector('[role="alert"]')).toBeNull();
  });

  it('refus du serveur (trop de messages) : message expliqué, le texte est gardé', async () => {
    online();
    component.text.setValue('encore un');

    component.send();
    socket.acknowledge('chat:send', { ok: false, message: 'Trop de messages, patientez un instant' });
    await Promise.resolve();
    fixture.detectChanges();

    expect(root().querySelector('[role="alert"]')?.textContent).toContain('Trop de messages, patientez un instant');
    expect(component.text.value).toBe('encore un');
  });

  it('bouton désactivé pour un message vide ou hors connexion', () => {
    const button = () => root().querySelector<HTMLButtonElement>('form button')!;
    component.text.setValue('bonjour');
    fixture.detectChanges();
    expect(button().disabled).toBe(true); // pas encore connecté au salon

    online();
    fixture.detectChanges();
    expect(button().disabled).toBe(false);

    component.text.setValue('   ');
    fixture.detectChanges();
    expect(button().disabled).toBe(true);
  });

  it('se vide quand on quitte le salon', () => {
    socket.receive('chat:message', message('m1', SAM, 'Salut !'));
    TestBed.inject(SyncService).disconnect();
    fixture.detectChanges();

    expect(bubbles()).toEqual([]);
  });
});
