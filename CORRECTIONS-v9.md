# Corrections de la version 9

- Une commande ou un collage `ipconfig /renew` ou `/release` demande de traiter les modifications IP non appliquées avant de poursuivre. Une adresse statique n’est plus effacée par `/release`.
- Le serveur DHCP refuse un pool réseau/diffusion ou hors de son réseau et une passerelle invalide ; les anciens baux hors plage ne sont plus réutilisés.
- La validation d’import refuse les ACL et autres structures réseau mal formées. Les projets Trame valides existants restent lisibles.
- Les adresses IP dupliquées produisent un avertissement dans l’inspecteur ; un conflit de destination joignable au sein d’un même domaine de niveau 2 est signalé lors d’un ping.
- Une simulation DHCP sans événement se termine avec un message d’échec ; les équipements sont verrouillés en mode Simulation. Le DHCP modifie le client avant l’animation.
- Contraste du bouton principal en thème sombre amélioré ; panneau d’exercice mobile limité en hauteur et défilable.

Voir le README pour les limites du simulateur. L’annulation/rétablissement, les protocoles supplémentaires et l’import Packet Tracer ne sont pas ajoutés dans cette version.
