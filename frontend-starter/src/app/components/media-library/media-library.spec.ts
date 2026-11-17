import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpEventType, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, TestRequest, provideHttpClientTesting } from '@angular/common/http/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Page } from '../../shared/models/page.model';
import { Media } from '../../shared/models/media.model';
import { MediaLibraryComponent } from './media-library';

const track = (id: string, title = `Morceau ${id}`): Media => ({
  id,
  kind: 'audio',
  title,
  originalName: `${id}.mp3`,
  mimeType: 'audio/mpeg',
  size: 2048,
  createdAt: '2026-10-01T10:00:00.000Z',
});

const page = (items: Media[], current = 1, pages = 1): Page<Media> => ({
  items,
  page: current,
  limit: 5,
  total: items.length,
  pages,
});

describe('MediaLibraryComponent', () => {
  let fixture: ComponentFixture<MediaLibraryComponent>;
  let component: MediaLibraryComponent;
  let http: HttpTestingController;
  let snackBar: { open: ReturnType<typeof vi.fn> };
  let confirmSpy: ReturnType<typeof vi.spyOn>;

  /** Requête GET de liste (l'upload POST partage la même URL). */
  const expectList = (pageNumber: number): TestRequest =>
    http.expectOne(
      (req) =>
        req.method === 'GET' && req.url === '/api/media' && req.params.get('page') === String(pageNumber),
    );

  /** Crée le composant sans répondre à la liste initiale. */
  const createPending = () => {
    fixture = TestBed.createComponent(MediaLibraryComponent);
    component = fixture.componentInstance;
  };

  /** Crée le composant et répond à la liste initiale (page 1). */
  const create = (initial: Page<Media> = page([track('a'), track('b')])) => {
    createPending();
    expectList(1).flush(initial);
    fixture.detectChanges();
  };

  beforeEach(() => {
    localStorage.clear();
    snackBar = { open: vi.fn() };
    confirmSpy = vi.spyOn(globalThis, 'confirm').mockReturnValue(true);
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: MatSnackBar, useValue: snackBar },
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    confirmSpy.mockRestore();
    localStorage.clear();
  });

  describe('bibliothèque', () => {
    it('charge la page 1 avec page et limit puis affiche une card par piste', () => {
      createPending();
      const request = expectList(1);
      expect(request.request.params.get('limit')).toBe('5');
      request.flush(page([track('a'), track('b')]));
      fixture.detectChanges();

      const cards = (fixture.nativeElement as HTMLElement).querySelectorAll('.media-card');
      expect(cards.length).toBe(2);
      expect(cards[0].textContent).toContain('Morceau a');
    });

    it("affiche un message d'erreur après un échec HTTP", () => {
      createPending();
      expectList(1).flush({ message: 'Erreur serveur' }, { status: 500, statusText: 'Server Error' });
      fixture.detectChanges();

      expect(component.listError()).toBe('Erreur serveur');
      expect(component.loading()).toBe(false);
      const alert = (fixture.nativeElement as HTMLElement).querySelector('[role="alert"]');
      expect(alert?.textContent).toContain('Erreur serveur');
    });

    it('go() fait une nouvelle requête avec la page demandée', () => {
      create(page([track('a')], 1, 3));

      component.go(2);

      expectList(2).flush(page([track('c')], 2, 3));
      expect(component.page()).toBe(2);
      expect(component.medias()[0].id).toBe('c');
    });

    it('go() ne fait aucune requête hors des bornes ni sur la page courante', () => {
      create(page([track('a')], 1, 3));

      component.go(0);
      component.go(4);
      component.go(1);
      // http.verify() (afterEach) échoue si une requête a été envoyée
    });
  });

  describe('suppression', () => {
    it('affiche un bouton « Supprimer » dans chaque card', () => {
      create();

      const buttons = Array.from(
        (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('.media-card .danger'),
      );
      expect(buttons.map((b) => b.textContent?.trim())).toEqual(['Supprimer', 'Supprimer']);
    });

    it("n'envoie aucune requête quand la confirmation est refusée", () => {
      create();
      confirmSpy.mockReturnValue(false);

      component.remove(track('a'));

      expect(confirmSpy).toHaveBeenCalledOnce();
      expect(component.deletingId()).toBeNull();
      expect(snackBar.open).not.toHaveBeenCalled();
    });

    it('appelle DELETE /api/media/:id, notifie puis recharge la liste', () => {
      create();

      component.remove(track('a', 'Blues'));

      const del = http.expectOne('/api/media/a');
      expect(del.request.method).toBe('DELETE');
      expect(component.deletingId()).toBe('a');
      del.flush(null, { status: 204, statusText: 'No Content' });

      expect(component.deletingId()).toBeNull();
      expect(snackBar.open).toHaveBeenCalledWith('« Blues » a été supprimé.', 'OK', expect.anything());
      expectList(1).flush(page([track('b')]));
      expect(component.medias().map((t) => t.id)).toEqual(['b']);
    });

    it("ignore un second clic pendant qu'une suppression est en cours", () => {
      create();

      component.remove(track('a'));
      component.remove(track('b'));

      // expectOne échouerait s'il y avait deux requêtes DELETE
      http.expectOne((req) => req.method === 'DELETE').flush(null, { status: 204, statusText: 'No Content' });
      expectList(1).flush(page([]));
      expect(confirmSpy).toHaveBeenCalledOnce();
    });

    it("404 : le média n'existe plus → message + rechargement", () => {
      create();

      component.remove(track('a'));
      http
        .expectOne('/api/media/a')
        .flush({ message: 'Piste inconnue' }, { status: 404, statusText: 'Not Found' });

      expect(component.deletingId()).toBeNull();
      expect(snackBar.open).toHaveBeenCalledWith(
        expect.stringContaining("n'existe plus"),
        'OK',
        expect.anything(),
      );
      // La card obsolète disparaît après le rechargement.
      expectList(1).flush(page([track('b')]));
      expect(component.medias().map((t) => t.id)).toEqual(['b']);
    });

    it('autre erreur : affiche le message du serveur sans recharger', () => {
      create();

      component.remove(track('a'));
      http
        .expectOne('/api/media/a')
        .flush({ message: 'Erreur interne' }, { status: 500, statusText: 'Server Error' });

      expect(component.deletingId()).toBeNull();
      expect(snackBar.open).toHaveBeenCalledWith('Erreur interne', 'OK', expect.anything());
      expect(component.medias().length).toBe(2); // liste inchangée, aucun GET supplémentaire
    });

    it("recule d'une page quand la dernière piste de la page courante est supprimée", () => {
      create(page([track('a')], 1, 2));
      component.go(2);
      expectList(2).flush(page([track('z')], 2, 2));

      component.remove(track('z'));
      http.expectOne('/api/media/z').flush(null, { status: 204, statusText: 'No Content' });
      // La page 2 est maintenant vide : le serveur ne compte plus qu'une page.
      expectList(2).flush({ items: [], page: 2, limit: 5, total: 5, pages: 1 });
      expectList(1).flush(page([track('a')], 1, 1));

      expect(component.page()).toBe(1);
      expect(component.medias().map((t) => t.id)).toEqual(['a']);
    });
  });

  describe('upload', () => {
    const audioFile = () => new File(['abc'], 'song.mp3', { type: 'audio/mpeg' });
    const postRequest = () => http.expectOne((req) => req.method === 'POST' && req.url === '/api/media');

    it('commence à idle', () => {
      create();
      expect(component.uploadState()).toEqual({ status: 'idle' });
    });

    it('met à jour le pourcentage, désactive le formulaire et bloque une seconde soumission', () => {
      create();
      component.file = audioFile();
      component.title.setValue('Mon titre');

      component.upload();
      expect(component.uploadState()).toEqual({ status: 'uploading', percent: 0 });
      expect(component.title.disabled).toBe(true);

      const request = postRequest();
      request.event({ type: HttpEventType.UploadProgress, loaded: 50, total: 200 });
      fixture.detectChanges();
      expect(component.uploadState()).toEqual({ status: 'uploading', percent: 25 });

      const root = fixture.nativeElement as HTMLElement;
      expect(root.querySelector('progress')?.getAttribute('value')).toBe('25');
      expect(root.querySelector<HTMLInputElement>('input[type="file"]')?.disabled).toBe(true);
      expect(root.querySelector<HTMLButtonElement>('.card button')?.disabled).toBe(true);

      component.upload(); // ignoré : une seconde requête ferait échouer http.verify()
      request.flush(track('new', 'Mon titre'));
      expectList(1).flush(page([track('new', 'Mon titre')]));
    });

    it('barre indéterminée quand la taille totale est inconnue', () => {
      create();
      component.file = audioFile();

      component.upload();
      const request = postRequest();
      request.event({ type: HttpEventType.UploadProgress, loaded: 10 });

      expect(component.uploadState()).toEqual({ status: 'uploading', percent: null });
      request.flush(track('new'));
      expectList(1).flush(page([track('new')]));
    });

    it('succès : état success, formulaire vidé et première page rechargée', () => {
      create(page([track('a')], 1, 2));
      component.go(2);
      expectList(2).flush(page([track('z')], 2, 2));
      component.file = audioFile();
      component.title.setValue('Mon titre');

      component.upload();
      const request = postRequest();
      expect(request.request.reportProgress).toBe(true);
      expect((request.request.body as FormData).get('title')).toBe('Mon titre');
      request.flush(track('new', 'Mon titre'));

      expect(component.uploadState()).toEqual({ status: 'success', title: 'Mon titre' });
      expect(component.uploadSuccess()).toContain('Mon titre');
      expect(component.file).toBeUndefined();
      expect(component.title.value).toBe('');
      expect(component.title.enabled).toBe(true);
      expect(component.page()).toBe(1);
      expectList(1).flush(page([track('new', 'Mon titre')]));
    });

    it('échec : état error avec le message du serveur, formulaire réactivé', () => {
      create();
      component.file = audioFile();

      component.upload();
      postRequest().flush({ message: 'Format de média non accepté' }, { status: 400, statusText: 'Bad Request' });
      fixture.detectChanges();

      expect(component.uploadState()).toEqual({ status: 'error', message: 'Format de média non accepté' });
      expect(component.title.enabled).toBe(true);
      expect((fixture.nativeElement as HTMLElement).textContent).toContain('Format de média non accepté');

      // Un nouvel essai est possible après l'échec.
      component.upload();
      postRequest().flush(track('ok'));
      expectList(1).flush(page([track('ok')]));
    });

    it('envoie le titre par défaut (nom du fichier) quand le titre est vide', () => {
      create();
      component.file = audioFile();

      component.upload();
      const request = postRequest();

      expect((request.request.body as FormData).get('title')).toBe('song.mp3');
      request.flush(track('new'));
      expectList(1).flush(page([track('new')]));
    });

    it("n'envoie rien sans fichier choisi", () => {
      create();

      component.upload();

      expect(component.uploadState()).toEqual({ status: 'idle' });
    });

    it('rejette un fichier invalide avant tout appel HTTP', () => {
      create();
      const input = { files: [new File(['x'], 'notes.txt', { type: 'text/plain' })], value: 'notes.txt' };

      component.choose({ target: input } as unknown as Event);

      expect(component.file).toBeUndefined();
      expect(component.fileError()).toContain('Format non supporté');
      expect(input.value).toBe('');
      // http.verify() (afterEach) garantit qu'aucune requête n'est partie
    });
  });

  describe('lecture', () => {
    it('signale le média choisi sans le charger elle-même', () => {
      create();
      const selected: Media[] = [];
      component.selected.subscribe((media) => selected.push(media));

      (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('.media-actions button')?.click();

      expect(selected.map((media) => media.id)).toEqual(['a']);
      // http.verify() (afterEach) garantit qu'aucune requête n'est partie
    });

    it('met en évidence le média chargé dans le lecteur du salon', () => {
      create();

      fixture.componentRef.setInput('activeMediaId', 'b');
      fixture.detectChanges();

      const cards = (fixture.nativeElement as HTMLElement).querySelectorAll('.media-card');
      expect(cards[0].classList.contains('playing')).toBe(false);
      expect(cards[1].classList.contains('playing')).toBe(true);
      expect(cards[1].textContent).toContain('Dans le lecteur');
    });
  });
});
